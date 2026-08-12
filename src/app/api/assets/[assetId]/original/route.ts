import { Readable } from "node:stream";

import { getAccessibleAsset } from "@/lib/assets/access";
import { mimeTypeForExtension } from "@/lib/assets/media-mime";
import { ensurePhotoWebPreview } from "@/lib/assets/photo-web-preview";
import { videoProxyCacheKey } from "@/lib/assets/transcoding";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { buildMediaAssetKey, getStorageAdapter } from "@/lib/storage";
import { allowInAppSourceForUserId } from "@/lib/playback/source-access";

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
    // suffix: bytes=-N
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
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { assetId } = await context.params;
    const asset = await getAccessibleAsset(session.user.id, assetId);

    if (!asset) {
      return new Response("Not found", { status: 404 });
    }

    const ownerId = asset.userId;
    const storage = getStorageAdapter();
    const { searchParams } = new URL(request.url);
    const playbackSource = searchParams.get("playback") === "source";
    const downloadOriginal = searchParams.get("download") === "original";

    if (playbackSource && !downloadOriginal) {
      const allowed = await allowInAppSourceForUserId(session.user.id);
      if (!allowed) {
        return new Response("Source playback disabled", { status: 403 });
      }
    }

    const preferProxy =
      !playbackSource &&
      !downloadOriginal &&
      (asset.assetType === "video" ||
        (asset.assetType === "sequence" &&
          asset.sequenceKind !== "panorama")) &&
      searchParams.get("proxy") !== "false";

    let key = buildMediaAssetKey(ownerId, assetId, asset.mainFileExt);
    let tier: "media" | "cache" = "media";
    let contentType = mimeTypeForExtension(asset.mainFileExt);

    if (
      asset.assetType === "photo" &&
      !playbackSource &&
      !downloadOriginal
    ) {
      const preview = await ensurePhotoWebPreview(
        ownerId,
        assetId,
        asset.mainFileExt,
      );
      if (preview) {
        key = preview.key;
        tier = "cache";
        contentType = preview.contentType;
      }
    }

    if (preferProxy) {
      const proxyKey = videoProxyCacheKey(ownerId, assetId);
      if (await storage.exists(proxyKey, { tier: "cache" })) {
        key = proxyKey;
        tier = "cache";
        contentType = "video/mp4";
      } else if (asset.assetType === "sequence") {
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
      } else if (asset.hasLrf) {
        // Prefer drone-generated low-res proxy when no cache proxy yet
        const lrfKey = buildMediaAssetKey(ownerId, assetId, "lrf");
        if (await storage.exists(lrfKey, { tier: "media" })) {
          key = lrfKey;
          tier = "media";
          contentType = "video/mp4";
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
        // Default playback path never streams the full-resolution original.
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
    const range = size != null ? parseRange(request.headers.get("range"), size) : null;

    const stream = await storage.getStream(key, {
      tier,
      ...(range ? { start: range.start, end: range.end } : {}),
    });
    if (!stream) {
      return new Response("Media not found", { status: 404 });
    }

    const webStream = Readable.toWeb(
      stream as unknown as Readable,
    ) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
      "Accept-Ranges": "bytes",
    };

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
    return jsonError(error);
  }
}
