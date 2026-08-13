/** Browser cache-busting thumbnail URL (private library). Client-safe — no Node imports. */
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

/** Public profile thumbnail URL with cache bust. Client-safe — no Node imports. */
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
