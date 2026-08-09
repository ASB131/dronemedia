import { buildCacheKey } from "@/lib/storage";

export function videoHlsPrefix(userId: string, assetId: string): string {
  return buildCacheKey("hls", userId, assetId);
}

export function videoHlsPlaylistKey(userId: string, assetId: string): string {
  return buildCacheKey("hls", userId, assetId, "index.m3u8");
}

export function videoHlsSegmentKey(
  userId: string,
  assetId: string,
  ...parts: string[]
): string {
  const safe = parts.map((part) => part.replace(/[^a-zA-Z0-9._-]/g, ""));
  return buildCacheKey("hls", userId, assetId, ...safe);
}

export function isSafeHlsPathSegment(name: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(name);
}

export function isSafeHlsPath(segments: string[]): boolean {
  return (
    segments.length >= 1 &&
    segments.length <= 4 &&
    segments.every(isSafeHlsPathSegment)
  );
}
