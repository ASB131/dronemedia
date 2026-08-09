import { buildCacheKey, buildMediaAssetKey } from "@/lib/storage";

export function videoProxyCacheKey(userId: string, assetId: string): string {
  return buildCacheKey("proxies", userId, `${assetId}.mp4`);
}

/** High-quality full-res sequence export (source resolution H.264). */
export function sequenceFullResExportKey(userId: string, assetId: string): string {
  return buildCacheKey("exports", userId, `${assetId}-fullres.mp4`);
}

/** Full-resolution stitched panorama JPEG (download / 180 viewer). */
export function panoramaEquirectCacheKey(
  userId: string,
  assetId: string,
): string {
  // v5: prefer DJI in-drone stitch (DJI_XXXX.JPG) when present.
  return buildCacheKey("panos", userId, assetId, "equirect-v5.jpg");
}

/** GPU-safe preview for Photo Sphere Viewer (360) — max 16384 edge. */
export function panoramaEquirectViewCacheKey(
  userId: string,
  assetId: string,
): string {
  return buildCacheKey("panos", userId, assetId, "equirect-v5-view.jpg");
}

/** Original DJI Fly / aircraft-stitched equirect on the media tier. */
export function panoramaDjiStitchedMediaKey(
  userId: string,
  assetId: string,
): string {
  return buildMediaAssetKey(userId, assetId, "dji-pano.jpg");
}
