export function thumbnailCacheKey(userId: string, assetId: string): string {
  return `thumbnails/${userId}/${assetId}.webp`;
}

export function photoWebPreviewCacheKey(
  userId: string,
  assetId: string,
): string {
  return `previews/${userId}/${assetId}.webp`;
}
