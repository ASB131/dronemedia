import { Readable } from "node:stream";

import { mimeTypeForExtension } from "@/lib/assets/media-mime";
import { ensurePhotoWebPreview } from "@/lib/assets/photo-web-preview";
import { videoProxyCacheKey } from "@/lib/assets/transcoding";
import { getPublicAssetForUsername } from "@/lib/profiles/queries";
import { buildMediaAssetKey, getStorageAdapter } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!header || !header.startsWith("bytes=") || size <= 0) return null;
  const spec = header.slice("bytes=".length).split(",")[0]?.trim();
  if (!spec) return null;
  const [startRaw, endRaw] = spec.split("-");
  let start = startRaw === "" ? NaN : Number(startRaw);
  let end = endRaw === "" || endRaw == null ? NaN : Number(endRaw);
  if (Number.isNaN(start) && Number.isNaN(end)) return null;
  if (Number.isNaN(start)) {
    const suffix = end;
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    if (!Number.isFinite(start) || start < 0) return null;
    end = Number.isNaN(end) ? size - 1 : end;
    if (!Number.isFinite(end) || end < start) return null;
    end = Math.min(end, size - 1);
  }
  if (start >= size) return null;
  return { start, end };
}

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

    const storage = getStorageAdapter();
    const { searchParams } = new URL(request.url);
    const playbackSource = searchParams.get("playback") === "source";

    let key = buildMediaAssetKey(asset.userId, asset.id, asset.mainFileExt);
    let tier: "media" | "cache" = "media";

    if (asset.assetType === "photo" && !playbackSource) {
      const preview = await ensurePhotoWebPreview(
        asset.userId,
        asset.id,
        asset.mainFileExt,
      );
      if (preview) {
        key = preview.key;
        tier = "cache";
      }
    }

    if (asset.assetType === "video" && !playbackSource) {
      const proxyKey = videoProxyCacheKey(asset.userId, asset.id);
      if (await storage.exists(proxyKey, { tier: "cache" })) {
        key = proxyKey;
        tier = "cache";
      } else if (asset.hasLrf) {
        const lrfKey = buildMediaAssetKey(asset.userId, asset.id, "lrf");
        if (await storage.exists(lrfKey, { tier: "media" })) {
          key = lrfKey;
          tier = "media";
        } else {
          return new Response(
            JSON.stringify({
              error: "Playback proxy not ready",
              status: "transcoding",
            }),
            {
              status: 503,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": "5",
                "Cache-Control": "no-store",
              },
            },
          );
        }
      } else {
        return new Response(
          JSON.stringify({
            error: "Playback proxy not ready",
            status: "transcoding",
          }),
          {
            status: 503,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "5",
              "Cache-Control": "no-store",
            },
          },
        );
      }
    }

    const size = await storage.size(key, { tier });
    const range =
      size != null ? parseRange(request.headers.get("range"), size) : null;

    const stream = await storage.getStream(key, {
      tier,
      ...(range ? { start: range.start, end: range.end } : {}),
    });
    if (!stream) {
      return new Response("Not found", { status: 404 });
    }

    const contentType =
      tier === "cache" && asset.assetType === "photo"
        ? "image/webp"
        : tier === "cache" || key.endsWith("/lrf")
          ? "video/mp4"
          : mimeTypeForExtension(asset.mainFileExt);

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
      "Accept-Ranges": "bytes",
    };

    const webStream = Readable.toWeb(
      stream as unknown as Readable,
    ) as unknown as BodyInit;

    if (range && size != null) {
      headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
      headers["Content-Length"] = String(range.end - range.start + 1);
      return new Response(webStream, { status: 206, headers });
    }

    if (size != null) {
      headers["Content-Length"] = String(size);
    }

    return new Response(webStream, { headers });
  } catch (error) {
    console.error(error);
    return new Response("Internal server error", { status: 500 });
  }
}
