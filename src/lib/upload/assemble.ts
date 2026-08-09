import { Readable } from "node:stream";

import { and, eq } from "drizzle-orm";

import { getWebDb } from "@/lib/db";
import { uploadFiles } from "@/lib/db/schema";
import { hashFileStream } from "@/lib/hash";
import { getStorageAdapter } from "@/lib/storage";
import {
  uploadAssembledKey,
  uploadChunkKey,
  uploadChunksPrefix,
} from "@/lib/upload/paths";

export async function assembleUploadFile(fileId: string, userId: string) {
  const db = getWebDb();
  const storage = getStorageAdapter();

  const rows = await db
    .select()
    .from(uploadFiles)
    .where(and(eq(uploadFiles.id, fileId), eq(uploadFiles.userId, userId)))
    .limit(1);

  const file = rows[0];
  if (!file) {
    throw new Error("Upload file not found");
  }

  if (file.status === "complete") {
    return file;
  }

  const uploaded = new Set(file.uploadedChunkIndices);
  for (let i = 0; i < file.totalChunks; i++) {
    if (!uploaded.has(i)) {
      throw new Error(`Missing chunk ${i}`);
    }
  }

  await db
    .update(uploadFiles)
    .set({ status: "assembling", updatedAt: new Date() })
    .where(eq(uploadFiles.id, fileId));

  async function* chunkParts() {
    for (let i = 0; i < file.totalChunks; i++) {
      const chunkKey = uploadChunkKey(userId, fileId, i);
      const chunkStream = await storage.getStream(chunkKey, { tier: "cache" });
      if (!chunkStream) {
        throw new Error(`Chunk ${i} missing on disk`);
      }
      for await (const part of chunkStream) {
        yield Buffer.isBuffer(part) ? part : Buffer.from(part);
      }
    }
  }

  const assembledKey = uploadAssembledKey(userId, fileId);
  await storage.put(assembledKey, Readable.from(chunkParts()), {
    tier: "cache",
  });

  const assembledStream = await storage.getStream(assembledKey, {
    tier: "cache",
  });
  if (!assembledStream) {
    throw new Error("Assembled file missing after write");
  }

  const { hash } = await hashFileStream(assembledStream);

  // Drop chunk copies immediately — assembled is the durable staging object.
  await storage.deletePrefix(uploadChunksPrefix(userId, fileId), {
    tier: "cache",
  });

  const [updated] = await db
    .update(uploadFiles)
    .set({
      status: "complete",
      contentHash: hash,
      receivedBytes: file.fileSizeBytes,
      updatedAt: new Date(),
    })
    .where(eq(uploadFiles.id, fileId))
    .returning();

  return updated;
}
