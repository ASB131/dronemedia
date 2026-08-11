import { addHours } from "@/lib/dates";
import { and, eq, sql } from "drizzle-orm";

import { loadConfig } from "@/lib/config";
import { getWebDb } from "@/lib/db";
import { uploadBatches, uploadFiles } from "@/lib/db/schema";
import {
  assertWithinQuota,
  getUserStorage,
} from "@/lib/api/auth";
import { parseFilename } from "@/lib/upload/filename";
import { normalizeRelativePath } from "@/lib/upload/sequences";
import { uploadStagingPrefix } from "@/lib/upload/paths";
import type { UploadInitBody } from "@/lib/upload/validators";

export async function createUploadBatch(userId: string, body: UploadInitBody) {
  const config = loadConfig();
  const db = getWebDb();

  const totalBytes = body.files.reduce((sum, f) => sum + f.sizeBytes, 0);
  const storage = await getUserStorage(userId);
  if (!storage) {
    throw new Error("User not found");
  }
  assertWithinQuota(
    storage.storageUsedBytes,
    storage.storageQuotaBytes,
    totalBytes,
  );

  for (const file of body.files) {
    if (file.sizeBytes > config.upload.maxFileSizeBytes) {
      throw new Error(`File ${file.filename} exceeds maximum upload size`);
    }
  }

  let batchId = body.batchId;
  if (batchId) {
    const existing = await db
      .select()
      .from(uploadBatches)
      .where(and(eq(uploadBatches.id, batchId), eq(uploadBatches.userId, userId)))
      .limit(1);
    if (!existing[0] || existing[0].status !== "open") {
      throw new Error("Invalid or closed batch");
    }
  } else {
    const [batch] = await db
      .insert(uploadBatches)
      .values({ userId })
      .returning();
    batchId = batch.id;
  }

  const chunkSizeBytes = config.upload.chunkSizeBytes;
  const expiresAt = addHours(new Date(), config.upload.incompleteUploadTtlHours);

  const sessions = [];
  for (const file of body.files) {
    const relativePath = normalizeRelativePath(file.relativePath);
    const parsed = parseFilename(
      relativePath ? relativePath.split("/").pop()! : file.filename,
    );
    const totalChunks = Math.max(1, Math.ceil(file.sizeBytes / chunkSizeBytes));

    const [row] = await db
      .insert(uploadFiles)
      .values({
        batchId: batchId!,
        userId,
        displayName: parsed.displayName,
        basename: parsed.basename,
        extension: parsed.extension,
        fileSizeBytes: file.sizeBytes,
        chunkSizeBytes,
        totalChunks,
        stagingPrefix: "", // set after id known
        clientModifiedAt: file.lastModifiedMs
          ? new Date(file.lastModifiedMs)
          : null,
        relativePath,
        expiresAt,
        status: "uploading",
      })
      .returning();

    const stagingPrefix = uploadStagingPrefix(userId, row.id);
    await db
      .update(uploadFiles)
      .set({ stagingPrefix, updatedAt: new Date() })
      .where(eq(uploadFiles.id, row.id));

    sessions.push({
      id: row.id,
      batchId,
      displayName: parsed.displayName,
      basename: parsed.basename,
      extension: parsed.extension,
      fileSizeBytes: file.sizeBytes,
      chunkSizeBytes,
      totalChunks,
      uploadedChunkIndices: [] as number[],
    });
  }

  return {
    batchId: batchId!,
    chunkSizeBytes,
    files: sessions,
  };
}

export async function getUploadFileStatus(fileId: string, userId: string) {
  const db = getWebDb();
  const rows = await db
    .select()
    .from(uploadFiles)
    .where(and(eq(uploadFiles.id, fileId), eq(uploadFiles.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getBatchStatus(batchId: string, userId: string) {
  const db = getWebDb();
  const batch = await db
    .select()
    .from(uploadBatches)
    .where(and(eq(uploadBatches.id, batchId), eq(uploadBatches.userId, userId)))
    .limit(1);

  if (!batch[0]) return null;

  const files = await db
    .select({
      id: uploadFiles.id,
      displayName: uploadFiles.displayName,
      basename: uploadFiles.basename,
      extension: uploadFiles.extension,
      status: uploadFiles.status,
      fileSizeBytes: uploadFiles.fileSizeBytes,
      receivedBytes: uploadFiles.receivedBytes,
      totalChunks: uploadFiles.totalChunks,
      uploadedChunkIndices: uploadFiles.uploadedChunkIndices,
      assetId: uploadFiles.assetId,
    })
    .from(uploadFiles)
    .where(eq(uploadFiles.batchId, batchId));

  return { batch: batch[0], files };
}

export async function recordUploadedChunk(params: {
  fileId: string;
  userId: string;
  chunkIndex: number;
  chunkBytes: number;
}) {
  const db = getWebDb();
  const file = await getUploadFileStatus(params.fileId, params.userId);
  if (!file) {
    throw new Error("Upload file not found");
  }
  if (file.status === "complete" || file.status === "cancelled") {
    throw new Error("Upload file is closed");
  }
  if (params.chunkIndex < 0 || params.chunkIndex >= file.totalChunks) {
    throw new Error("Invalid chunk index");
  }

  // Atomic merge — parallel chunk PUTs must not clobber each other's indices
  // via read-modify-write races.
  const [updated] = await db
    .update(uploadFiles)
    .set({
      uploadedChunkIndices: sql`(
        SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i), '[]'::jsonb)
        FROM (
          SELECT DISTINCT i
          FROM (
            SELECT jsonb_array_elements_text(
              COALESCE(uploaded_chunk_indices, '[]'::jsonb)
            )::int AS i
            UNION ALL
            SELECT ${params.chunkIndex}::int
          ) merged
        ) distinct_indices
      )`,
      receivedBytes: sql`LEAST(
        file_size_bytes,
        CASE
          WHEN COALESCE(uploaded_chunk_indices, '[]'::jsonb)
            @> to_jsonb(${params.chunkIndex}::int)
          THEN received_bytes
          ELSE received_bytes + ${params.chunkBytes}
        END
      )`,
      status: "uploading",
      lastChunkAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(uploadFiles.id, params.fileId),
        eq(uploadFiles.userId, params.userId),
      ),
    )
    .returning({
      uploadedChunkIndices: uploadFiles.uploadedChunkIndices,
    });

  if (!updated) {
    throw new Error("Upload file not found");
  }

  return { uploadedChunkIndices: updated.uploadedChunkIndices };
}

export async function markUploadFileFailed(params: {
  fileId: string;
  userId: string;
  errorMessage?: string;
}) {
  const db = getWebDb();
  const file = await getUploadFileStatus(params.fileId, params.userId);
  if (!file) {
    throw new Error("Upload file not found");
  }
  if (file.status === "complete" || file.status === "cancelled") {
    return file;
  }

  const [updated] = await db
    .update(uploadFiles)
    .set({
      status: "failed",
      errorMessage: params.errorMessage?.slice(0, 2000) ?? "Upload failed",
      updatedAt: new Date(),
    })
    .where(eq(uploadFiles.id, params.fileId))
    .returning();

  return updated ?? file;
}
