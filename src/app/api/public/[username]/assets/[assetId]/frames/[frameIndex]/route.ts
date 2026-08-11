import { Readable } from "node:stream";

import { and, eq } from "drizzle-orm";
import sharp from "sharp";

import { mimeTypeForExtension } from "@/lib/assets/media-mime";
import { sequenceFrameThumbCacheKey } from "@/lib/assets/thumbnails";
import { loadConfig } from "@/lib/config";
import { getWebDb } from "@/lib/db";
import { sequenceFrames } from "@/lib/db/schema";
import { getPublicAssetForUsername } from "@/lib/profiles/queries";
import { getStorageAdapter } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FRAME_THUMB_EDGE = 360;

export async function GET(
  request: Request,
  context: {
    params: Promise<{
      username: string;
      assetId: string;
      frameIndex: string;
    }>;
  },
) {
  try {
    const { username, assetId, frameIndex: frameIndexRaw } =
      await context.params;
    const frameIndex = Number.parseInt(frameIndexRaw, 10);
    if (!Number.isFinite(frameIndex) || frameIndex < 0) {
      return new Response("Invalid frame", { status: 400 });
    }

    const asset = await getPublicAssetForUsername(username, assetId);
    if (!asset) {
      return new Response("Not found", { status: 404 });
    }
    if (asset.assetType !== "sequence") {
      return new Response("Not a sequence", { status: 404 });
    }

    const db = getWebDb();
    const [frame] = await db
      .select()
      .from(sequenceFrames)
      .where(
        and(
          eq(sequenceFrames.assetId, assetId),
          eq(sequenceFrames.frameIndex, frameIndex),
        ),
      )
      .limit(1);

    if (!frame) {
      return new Response("Not found", { status: 404 });
    }

    const storage = getStorageAdapter();
    const wantThumb =
      new URL(request.url).searchParams.get("thumb") === "1" ||
      new URL(request.url).searchParams.get("size") === "thumb";

    if (wantThumb) {
      const thumbKey = sequenceFrameThumbCacheKey(
        asset.userId,
        assetId,
        frameIndex,
      );
      const cached = await storage.get(thumbKey, { tier: "cache" });
      if (cached) {
        return new Response(new Uint8Array(cached), {
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "public, max-age=86400",
          },
        });
      }

      const original = await storage.get(frame.storageKey, { tier: "media" });
      if (!original) {
        return new Response("Not found", { status: 404 });
      }

      const config = loadConfig();
      const edge = Math.min(
        FRAME_THUMB_EDGE,
        config.images.thumbnailMaxEdge || FRAME_THUMB_EDGE,
      );
      const webp = await sharp(original, { limitInputPixels: false })
        .rotate()
        .resize(edge, edge, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: Math.min(80, config.images.thumbnailQuality || 80) })
        .toBuffer();

      await storage
        .put(thumbKey, webp, { tier: "cache", contentType: "image/webp" })
        .catch(() => undefined);

      return new Response(new Uint8Array(webp), {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    const stream = await storage.getStream(frame.storageKey, { tier: "media" });
    if (!stream) {
      return new Response("Not found", { status: 404 });
    }

    const ext =
      frame.filename.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
      "jpg";
    const contentType = mimeTypeForExtension(ext);

    const webStream = Readable.toWeb(
      stream as unknown as Readable,
    ) as ReadableStream;

    return new Response(webStream, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error(error);
    return new Response("Internal server error", { status: 500 });
  }
}
