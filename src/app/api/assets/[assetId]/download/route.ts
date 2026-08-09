import { createRequire } from "node:module";
import { PassThrough, Readable } from "node:stream";

import { asc, eq } from "drizzle-orm";

import { getAccessibleAsset } from "@/lib/assets/access";
import { mimeTypeForExtension } from "@/lib/assets/media-mime";
import {
  panoramaEquirectCacheKey,
  sequenceFullResExportKey,
  videoProxyCacheKey,
} from "@/lib/assets/transcoding";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { loadConfig } from "@/lib/config";
import { getWebDb } from "@/lib/db";
import { sequenceFrames } from "@/lib/db/schema";
import { getSequenceExportQueue } from "@/lib/jobs/queues";
import { buildMediaAssetKey, getStorageAdapter } from "@/lib/storage";

const require = createRequire(import.meta.url);
const archiver = require("archiver") as (
  format: string,
  options?: { zlib?: { level?: number } },
) => {
  on(event: string, cb: (error: Error) => void): void;
  pipe(stream: PassThrough): void;
  append(
    data: NodeJS.ReadableStream | Buffer,
    options: { name: string },
  ): void;
  finalize(): Promise<void>;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeBaseName(displayName: string) {
  return displayName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "asset";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { assetId } = await context.params;
    const asset = await getAccessibleAsset(session.user.id, assetId);
    if (!asset) {
      return new Response("Not found", { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const includeSrt = searchParams.get("srt") === "1" && asset.hasSrt;
    const includeLrf =
      (searchParams.get("lrf") === "1" || searchParams.get("lrt") === "1") &&
      asset.hasLrf;
    const source = searchParams.get("source");
    const preferProxy = source === "proxy";
    const preferOriginal = source === "original";

    const ownerId = asset.userId;
    const storage = getStorageAdapter();
    const base = safeBaseName(asset.displayName);

    if (asset.assetType === "sequence") {
      if (source === "pano" || source === "equirect") {
        if (asset.sequenceKind !== "panorama") {
          return new Response("Not a panorama", { status: 404 });
        }
        const panoKey = panoramaEquirectCacheKey(ownerId, assetId);
        if (!(await storage.exists(panoKey, { tier: "cache" }))) {
          return Response.json(
            { error: "Panorama preview not ready" },
            { status: 503 },
          );
        }
        const stream = await storage.getStream(panoKey, { tier: "cache" });
        if (!stream) {
          return new Response("Not found", { status: 404 });
        }
        const webStream = Readable.toWeb(
          stream as unknown as Readable,
        ) as ReadableStream;
        return new Response(webStream, {
          headers: {
            "Content-Type": "image/jpeg",
            "Content-Disposition": `attachment; filename="${base}-panorama.jpg"`,
            "Cache-Control": "private, no-store",
          },
        });
      }

      const wantFullRes = source === "fullres" || source === "mp4";
      if (wantFullRes) {
        if (asset.sequenceKind === "panorama") {
          return new Response("Panoramas do not export as MP4", { status: 400 });
        }
        const exportKey = sequenceFullResExportKey(ownerId, assetId);
        if (await storage.exists(exportKey, { tier: "cache" })) {
          const stream = await storage.getStream(exportKey, { tier: "cache" });
          if (!stream) {
            return new Response("Export not found", { status: 404 });
          }
          const webStream = Readable.toWeb(
            stream as unknown as Readable,
          ) as ReadableStream;
          return new Response(webStream, {
            headers: {
              "Content-Type": "video/mp4",
              "Content-Disposition": `attachment; filename="${base}.mp4"`,
              "Cache-Control": "private, no-store",
            },
          });
        }

        const config = loadConfig();
        await getSequenceExportQueue().add(
          "sequenceExport",
          { userId: ownerId, assetId },
          {
            jobId: `sequence-export-${assetId}`,
            attempts: config.jobs.retry.attempts,
            backoff: {
              type: "exponential",
              delay: config.jobs.retry.backoffMs,
            },
          },
        );

        return Response.json(
          {
            status: "preparing",
            message: "Full-resolution MP4 is being prepared. Retry shortly.",
          },
          {
            status: 202,
            headers: { "Retry-After": "5", "Cache-Control": "no-store" },
          },
        );
      }

      // Default: zip of original frames
      const db = getWebDb();
      const frames = await db
        .select()
        .from(sequenceFrames)
        .where(eq(sequenceFrames.assetId, assetId))
        .orderBy(asc(sequenceFrames.frameIndex));

      if (frames.length === 0) {
        return new Response("No frames found", { status: 404 });
      }

      const pass = new PassThrough();
      const archive = archiver("zip", { zlib: { level: 1 } });
      archive.on("error", (error: Error) => {
        pass.destroy(error);
      });
      archive.pipe(pass);

      void (async () => {
        for (const frame of frames) {
          const stream = await storage.getStream(frame.storageKey, {
            tier: "media",
          });
          if (!stream) continue;
          archive.append(stream, { name: frame.filename });
        }
        await archive.finalize();
      })().catch((error: Error) => {
        pass.destroy(error);
      });

      const folder = asset.sequenceFolder ?? base;
      return new Response(Readable.toWeb(pass) as ReadableStream, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${safeBaseName(folder)}-frames.zip"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    const mainExt = asset.mainFileExt.replace(/^\./, "").toLowerCase();
    const mainKey = buildMediaAssetKey(ownerId, assetId, mainExt);

    // Sidecars always accompany the original. A proxy download is only useful
    // on its own, and must gracefully fall back to the original when absent.
    if (!includeSrt && !includeLrf) {
      let key = mainKey;
      let tier: "media" | "cache" = "media";
      let extension = mainExt;

      // Explicit original never falls back to LRF/proxy. Proxy is opt-in only.
      if (preferProxy && !preferOriginal && asset.assetType === "video") {
        const proxyKey = videoProxyCacheKey(ownerId, assetId);
        if (await storage.exists(proxyKey, { tier: "cache" })) {
          key = proxyKey;
          tier = "cache";
          extension = "mp4";
        } else if (asset.hasLrf) {
          const lrfKey = buildMediaAssetKey(ownerId, assetId, "lrf");
          if (await storage.exists(lrfKey, { tier: "media" })) {
            key = lrfKey;
            extension = "mp4";
          }
        }
      }

      const stream = await storage.getStream(key, { tier });
      if (!stream) {
        return new Response("Media not found", { status: 404 });
      }
      const webStream = Readable.toWeb(
        stream as unknown as Readable,
      ) as ReadableStream;
      const filename = `${base}.${extension}`;
      return new Response(webStream, {
        headers: {
          "Content-Type": mimeTypeForExtension(extension),
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    const mainStream = await storage.getStream(mainKey, { tier: "media" });
    if (!mainStream) {
      return new Response("Media not found", { status: 404 });
    }

    const pass = new PassThrough();
    const archive = archiver("zip", { zlib: { level: 1 } });
    archive.on("error", (error: Error) => {
      pass.destroy(error);
    });
    archive.pipe(pass);

    void (async () => {
      archive.append(mainStream, { name: `${base}.${mainExt}` });

      if (includeSrt) {
        const srtKey = buildMediaAssetKey(ownerId, assetId, "srt");
        const srtStream = await storage.getStream(srtKey, { tier: "media" });
        if (srtStream) {
          archive.append(srtStream, { name: `${base}.SRT` });
        }
      }

      if (includeLrf) {
        const lrfKey = buildMediaAssetKey(ownerId, assetId, "lrf");
        const lrfStream = await storage.getStream(lrfKey, { tier: "media" });
        if (lrfStream) {
          archive.append(lrfStream, { name: `${base}.LRF` });
        }
      }

      await archive.finalize();
    })().catch((error: Error) => {
      pass.destroy(error);
    });

    return new Response(Readable.toWeb(pass) as ReadableStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${base}-download.zip"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
