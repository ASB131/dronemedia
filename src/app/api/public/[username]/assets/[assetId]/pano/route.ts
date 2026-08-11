import { Readable } from "node:stream";

import {
  effectivePanoramaViewer,
  isEquirectViewerMode,
} from "@/lib/assets/panorama-viewer-mode";
import { ensurePanoramaWebPreview } from "@/lib/assets/panorama-web-preview";
import {
  panoramaDjiStitchedMediaKey,
  panoramaEquirectCacheKey,
  panoramaEquirectViewCacheKey,
} from "@/lib/assets/transcoding";
import { getPublicAssetForUsername } from "@/lib/profiles/queries";
import { buildMediaAssetKey, getStorageAdapter } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ username: string; assetId: string }> },
) {
  try {
    const { username, assetId } = await context.params;
    const asset = await getPublicAssetForUsername(username, assetId);
    if (!asset) {
      return new Response("Not found", { status: 404 });
    }

    const viewer = effectivePanoramaViewer(asset);
    const isSequencePano =
      asset.assetType === "sequence" && asset.sequenceKind === "panorama";
    const isPhotoEquirect =
      asset.assetType === "photo" && isEquirectViewerMode(viewer);

    if (!isSequencePano && !isPhotoEquirect) {
      return new Response("Not a panorama", { status: 404 });
    }

    const params = new URL(request.url).searchParams;
    const wantSource =
      params.get("full") === "1" || params.get("quality") === "source";
    const storage = getStorageAdapter();
    const ownerId = asset.userId;

    if (isPhotoEquirect) {
      const djiKey = panoramaDjiStitchedMediaKey(ownerId, assetId);
      const mainKey = buildMediaAssetKey(
        ownerId,
        assetId,
        asset.mainFileExt || "jpg",
      );
      const hasDji = await storage.exists(djiKey, { tier: "media" });
      const sourceKey = hasDji ? djiKey : mainKey;

      if (!wantSource) {
        const preview = await ensurePanoramaWebPreview(ownerId, assetId);
        if (preview) {
          const stream = await storage.getStream(preview.key, {
            tier: "cache",
          });
          if (stream) {
            const webStream = Readable.toWeb(
              stream as unknown as Readable,
            ) as ReadableStream;
            return new Response(webStream, {
              headers: {
                "Content-Type": preview.contentType,
                "Cache-Control": "public, max-age=86400",
                Vary: "Accept",
              },
            });
          }
        }
      }

      const stream = await storage.getStream(sourceKey, { tier: "media" });
      if (!stream) {
        return new Response("Not found", { status: 404 });
      }
      const webStream = Readable.toWeb(
        stream as unknown as Readable,
      ) as ReadableStream;
      return new Response(webStream, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    const djiKey = panoramaDjiStitchedMediaKey(ownerId, assetId);
    const hasDji = await storage.exists(djiKey, { tier: "media" });

    if (wantSource) {
      if (hasDji) {
        const stream = await storage.getStream(djiKey, { tier: "media" });
        if (stream) {
          const webStream = Readable.toWeb(
            stream as unknown as Readable,
          ) as ReadableStream;
          return new Response(webStream, {
            headers: {
              "Content-Type": "image/jpeg",
              "Cache-Control": "public, max-age=3600",
            },
          });
        }
      }
      for (const key of [
        panoramaEquirectCacheKey(ownerId, assetId),
        panoramaEquirectViewCacheKey(ownerId, assetId),
      ]) {
        if (await storage.exists(key, { tier: "cache" })) {
          const stream = await storage.getStream(key, { tier: "cache" });
          if (stream) {
            const webStream = Readable.toWeb(
              stream as unknown as Readable,
            ) as ReadableStream;
            return new Response(webStream, {
              headers: {
                "Content-Type": "image/jpeg",
                "Cache-Control": "public, max-age=3600",
              },
            });
          }
        }
      }
      return Response.json(
        { error: "Panorama image missing", status: "missing" },
        { status: 404 },
      );
    }

    const preview = await ensurePanoramaWebPreview(ownerId, assetId);
    if (preview) {
      const stream = await storage.getStream(preview.key, { tier: "cache" });
      if (stream) {
        const webStream = Readable.toWeb(
          stream as unknown as Readable,
        ) as ReadableStream;
        return new Response(webStream, {
          headers: {
            "Content-Type": preview.contentType,
            "Cache-Control": "public, max-age=86400",
            Vary: "Accept",
          },
        });
      }
    }

    return Response.json(
      {
        error: hasDji
          ? "Panorama preview not ready"
          : "Panorama image missing",
        status: hasDji ? "building" : "missing",
      },
      { status: hasDji ? 503 : 404 },
    );
  } catch (error) {
    console.error(error);
    return new Response("Internal server error", { status: 500 });
  }
}
