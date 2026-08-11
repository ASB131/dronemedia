import { buildCacheKey, buildMediaAssetKey } from "@/lib/storage";

export function videoProxyCacheKey(userId: string, assetId: string): string {
  return buildCacheKey("proxies", userId, `${assetId}.mp4`);
}

/** High-quality full-res sequence export (source resolution H.264). */
export function sequenceFullResExportKey(userId: string, assetId: string): string {
  return buildCacheKey("exports", userId, `${assetId}-fullres.mp4`);
}

/** Legacy full-resolution equirect copy on cache (older tile-stitched panos). */
export function panoramaEquirectCacheKey(
  userId: string,
  assetId: string,
): string {
  return buildCacheKey("panos", userId, assetId, "equirect-v5.jpg");
}

/** Legacy GPU-safe 16k view JPEG (older panos). */
export function panoramaEquirectViewCacheKey(
  userId: string,
  assetId: string,
): string {
  return buildCacheKey("panos", userId, assetId, "equirect-v5-view.jpg");
}

/** In-app web preview of the large pano (high-res, lightly compressed). */
export function panoramaEquirectWebCacheKey(
  userId: string,
  assetId: string,
): string {
  // v3: build only from DJI / full equirect (never the soft 16k-view derivative).
  return buildCacheKey("panos", userId, assetId, "equirect-web-v3.jpg");
}

/**
 * Long edge for panorama web previews.
 * Close to source / GPU-safe; Source downloads still use media originals.
 */
export const PANORAMA_WEB_MAX_EDGE = 12288;

/** JPEG quality for panorama web previews (visually near source, smaller file). */
export const PANORAMA_WEB_JPEG_QUALITY = 92;

export { PANORAMA_WEB_CACHE_VERSION } from "./panorama-web-version";

/** Original DJI Fly / aircraft-stitched equirect on the media tier. */
export function panoramaDjiStitchedMediaKey(
  userId: string,
  assetId: string,
): string {
  return buildMediaAssetKey(userId, assetId, "dji-pano.jpg");
}
