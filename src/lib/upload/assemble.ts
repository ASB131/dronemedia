import { Readable } from "node:stream";

import { and, eq } from "drizzle-orm";

import { getWebDb } from "@/lib/db";
import { uploadFiles } from "@/lib/db/schema";
import { createPrimaryContentHasher } from "@/lib/hash";
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
  const recovered: number[] = [];
  for (let i = 0; i < file.totalChunks; i++) {
    if (uploaded.has(i)) continue;
    const onDisk = await storage.exists(uploadChunkKey(userId, fileId, i), {
      tier: "cache",
    });
    if (onDisk) {
      uploaded.add(i);
      recovered.push(i);
      continue;
    }
    throw new Error(`Missing chunk ${i}`);
  }

  if (recovered.length > 0) {
    await db
      .update(uploadFiles)
      .set({
        uploadedChunkIndices: [...uploaded].sort((a, b) => a - b),
        updatedAt: new Date(),
      })
      .where(eq(uploadFiles.id, fileId));
  }

  await db
    .update(uploadFiles)
    .set({ status: "assembling", updatedAt: new Date() })
    .where(eq(uploadFiles.id, fileId));

  // Single pass: concatenate chunks + primary content hash together.
  // Previously we wrote the assembled object, then re-read the whole file to
  // compute both xxhash and SHA-256 — that second full-file pass dominated
  // assemble time on large videos.
  const hasher = createPrimaryContentHasher();

  async function* chunkParts() {
    for (let i = 0; i < file.totalChunks; i++) {
      const chunkKey = uploadChunkKey(userId, fileId, i);
      // Whole-chunk read (16MB) avoids tiny stream reads per chunk file.
      const data = await storage.get(chunkKey, { tier: "cache" });
      if (!data || data.length === 0) {
        throw new Error(`Chunk ${i} missing on disk`);
      }
      hasher.update(data);
      yield data;
    }
  }

  const assembledKey = uploadAssembledKey(userId, fileId);
  await storage.put(assembledKey, Readable.from(chunkParts()), {
    tier: "cache",
  });
  const { hash } = hasher.digest();

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
