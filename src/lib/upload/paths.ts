import { buildCacheKey } from "@/lib/storage";

export function uploadStagingPrefix(userId: string, fileId: string): string {
  return buildCacheKey("uploads", userId, fileId);
}

export function uploadChunksPrefix(userId: string, fileId: string): string {
  return buildCacheKey("uploads", userId, fileId, "chunks");
}

export function uploadChunkKey(
  userId: string,
  fileId: string,
  chunkIndex: number,
): string {
  return buildCacheKey("uploads", userId, fileId, "chunks", String(chunkIndex));
}

export function uploadAssembledKey(userId: string, fileId: string): string {
  return buildCacheKey("uploads", userId, fileId, "assembled");
}
