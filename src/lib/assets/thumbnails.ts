import { buildCacheKey } from "@/lib/storage/types";

export function thumbnailCacheKey(userId: string, assetId: string): string {
  return buildCacheKey("thumbnails", userId, `${assetId}.webp`);
}

export function placeholderThumbnailCacheKey(
  userId: string,
  assetId: string,
): string {
  return buildCacheKey("thumbnails", userId, `${assetId}.placeholder.webp`);
}

/** Long-edge web preview for in-app photo viewing (cache tier). */
export function photoWebPreviewCacheKey(
  userId: string,
  assetId: string,
): string {
  return buildCacheKey("previews", userId, `${assetId}.webp`);
}

/** Small WebP for panorama tile grids / map previews. */
export function sequenceFrameThumbCacheKey(
  userId: string,
  assetId: string,
  frameIndex: number,
): string {
  const index = String(Math.max(0, frameIndex)).padStart(5, "0");
  return buildCacheKey(
    "thumbnails",
    userId,
    assetId,
    `frame-${index}.webp`,
  );
}
