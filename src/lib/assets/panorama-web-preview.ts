import sharp from "sharp";

import {
  PANORAMA_WEB_JPEG_QUALITY,
  PANORAMA_WEB_MAX_EDGE,
  panoramaDjiStitchedMediaKey,
  panoramaEquirectCacheKey,
  panoramaEquirectViewCacheKey,
  panoramaEquirectWebCacheKey,
} from "@/lib/assets/transcoding";
import { getStorageAdapter } from "@/lib/storage";

/**
 * Build (or return existing) cache web preview for in-app panorama viewing.
 * Prefer the large media pano (dji-pano.jpg), then the full equirect cache.
 * Never upsample from equirect-*-view.jpg — that was a soft viewer derivative.
 */
export async function ensurePanoramaWebPreview(
  userId: string,
  assetId: string,
): Promise<{ key: string; contentType: string } | null> {
  const storage = getStorageAdapter();
  const webKey = panoramaEquirectWebCacheKey(userId, assetId);
  if (await storage.exists(webKey, { tier: "cache" })) {
    return { key: webKey, contentType: "image/jpeg" };
  }

  const djiKey = panoramaDjiStitchedMediaKey(userId, assetId);
  const source =
    (await storage.get(djiKey, { tier: "media" })) ??
    (await storage.get(panoramaEquirectCacheKey(userId, assetId), {
      tier: "cache",
    })) ??
    // Last resort only — soft GPU view derivative from older builds.
    (await storage.get(panoramaEquirectViewCacheKey(userId, assetId), {
      tier: "cache",
    }));

  if (!source) return null;

  const jpeg = await sharp(source, { limitInputPixels: false })
    .rotate()
    .resize(PANORAMA_WEB_MAX_EDGE, PANORAMA_WEB_MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: PANORAMA_WEB_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  await storage.put(webKey, jpeg, {
    tier: "cache",
    contentType: "image/jpeg",
  });
  return { key: webKey, contentType: "image/jpeg" };
}

/** True when a large pano image exists (media DJI or any equirect/web cache). */
export async function panoramaHasLargeImage(
  userId: string,
  assetId: string,
): Promise<boolean> {
  const storage = getStorageAdapter();
  if (
    await storage.exists(panoramaDjiStitchedMediaKey(userId, assetId), {
      tier: "media",
    })
  ) {
    return true;
  }
  if (
    await storage.exists(panoramaEquirectWebCacheKey(userId, assetId), {
      tier: "cache",
    })
  ) {
    return true;
  }
  if (
    await storage.exists(panoramaEquirectCacheKey(userId, assetId), {
      tier: "cache",
    })
  ) {
    return true;
  }
  // Legacy viewer derivative still counts as “has an image” for readiness.
  return storage.exists(panoramaEquirectViewCacheKey(userId, assetId), {
    tier: "cache",
  });
}
