import { getStorageAdapter } from "@/lib/storage";
import { uploadChunkKey } from "@/lib/upload/paths";

export async function writeUploadChunk(params: {
  userId: string;
  fileId: string;
  chunkIndex: number;
  chunkSizeBytes: number;
  data: Buffer;
}) {
  const storage = getStorageAdapter();
  const key = uploadChunkKey(params.userId, params.fileId, params.chunkIndex);

  if (params.data.length > params.chunkSizeBytes) {
    throw new Error("Chunk exceeds configured chunk size");
  }

  await storage.put(key, params.data, { tier: "cache" });
}
