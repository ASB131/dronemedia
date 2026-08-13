import { buildCacheKey } from "@/lib/storage";

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

/** Browser cache-busting thumbnail URL (private library). */
export function assetThumbnailSrc(
  assetId: string,
  updatedAt?: string | Date | null,
): string {
  const v =
    updatedAt == null
      ? 0
      : typeof updatedAt === "string"
        ? new Date(updatedAt).getTime()
        : updatedAt.getTime();
  const stamp = Number.isFinite(v) ? v : 0;
  return `/api/assets/${assetId}/thumbnail?v=${stamp}`;
}

/** Public profile thumbnail URL with cache bust. */
export function publicAssetThumbnailSrc(
  username: string,
  assetId: string,
  updatedAt?: string | Date | null,
): string {
  const v =
    updatedAt == null
      ? 0
      : typeof updatedAt === "string"
        ? new Date(updatedAt).getTime()
        : updatedAt.getTime();
  const stamp = Number.isFinite(v) ? v : 0;
  return `/api/public/${encodeURIComponent(username)}/assets/${assetId}/thumbnail?v=${stamp}`;
}
