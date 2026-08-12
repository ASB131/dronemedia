import { and, eq, inArray, sql } from "drizzle-orm";

import { getWebDb } from "@/lib/db";
import { uploadBatches, uploadFiles } from "@/lib/db/schema";

export type UploadStagingFileDto = {
  id: string;
  displayName: string;
  status: string;
  batchId: string;
  batchStatus: string;
  fileSizeBytes: number;
  assetId: string | null;
};

export type UploadStagingBatchDto = {
  batchId: string;
  status: string;
  moved: number;
  total: number;
  bytesRemaining: number;
};

export type UploadStagingStatusDto = {
  assembling: number;
  uploading: number;
  /** Assembled in cache, waiting for finalize / library move. */
  readyInCache: number;
  /** Files already linked to an asset during an in-flight commit. */
  movedToLibrary: number;
  bytesInCache: number;
  committingBatches: UploadStagingBatchDto[];
  samples: UploadStagingFileDto[];
};

/**
 * Where the user's uploads currently live: cache staging vs library move.
 */
export async function getUploadStagingStatusForUser(
  userId: string,
): Promise<UploadStagingStatusDto> {
  const db = getWebDb();

  const rows = await db
    .select({
      id: uploadFiles.id,
      displayName: uploadFiles.displayName,
      status: uploadFiles.status,
      batchId: uploadFiles.batchId,
      batchStatus: uploadBatches.status,
      fileSizeBytes: uploadFiles.fileSizeBytes,
      assetId: uploadFiles.assetId,
    })
    .from(uploadFiles)
    .innerJoin(uploadBatches, eq(uploadFiles.batchId, uploadBatches.id))
    .where(
      and(
        eq(uploadFiles.userId, userId),
        inArray(uploadBatches.status, ["open", "committing"]),
        inArray(uploadFiles.status, [
          "pending",
          "uploading",
          "assembling",
          "complete",
          "failed",
        ]),
      ),
    )
    .orderBy(sql`${uploadFiles.updatedAt} desc`)
    .limit(200);

  let assembling = 0;
  let uploading = 0;
  let readyInCache = 0;
  let movedToLibrary = 0;
  let bytesInCache = 0;

  const byBatch = new Map<
    string,
    { status: string; moved: number; total: number; bytesRemaining: number }
  >();

  for (const row of rows) {
    if (row.status === "assembling") assembling += 1;
    if (row.status === "pending" || row.status === "uploading") uploading += 1;

    if (row.assetId) {
      movedToLibrary += 1;
    } else if (row.status === "complete") {
      readyInCache += 1;
      bytesInCache += row.fileSizeBytes;
    } else if (
      row.status === "assembling" ||
      row.status === "uploading" ||
      row.status === "pending"
    ) {
      bytesInCache += row.fileSizeBytes;
    }

    if (row.batchStatus === "committing" || row.status === "complete") {
      const entry = byBatch.get(row.batchId) ?? {
        status: row.batchStatus,
        moved: 0,
        total: 0,
        bytesRemaining: 0,
      };
      if (row.status === "complete" || row.assetId) {
        entry.total += 1;
        if (row.assetId) entry.moved += 1;
        else entry.bytesRemaining += row.fileSizeBytes;
      }
      entry.status = row.batchStatus;
      byBatch.set(row.batchId, entry);
    }
  }

  const committingBatches: UploadStagingBatchDto[] = [...byBatch.entries()]
    .filter(([, v]) => v.status === "committing" || v.moved < v.total)
    .map(([batchId, v]) => ({
      batchId,
      status: v.status,
      moved: v.moved,
      total: v.total,
      bytesRemaining: v.bytesRemaining,
    }))
    .filter((b) => b.total > 0)
    .sort((a, b) => {
      if (a.status === "committing" && b.status !== "committing") return -1;
      if (b.status === "committing" && a.status !== "committing") return 1;
      return b.total - a.total;
    });

  const samples: UploadStagingFileDto[] = rows
    .filter((row) => !row.assetId || row.batchStatus === "committing")
    .slice(0, 40)
    .map((row) => ({
      id: row.id,
      displayName: row.displayName,
      status: row.status,
      batchId: row.batchId,
      batchStatus: row.batchStatus,
      fileSizeBytes: row.fileSizeBytes,
      assetId: row.assetId,
    }));

  return {
    assembling,
    uploading,
    readyInCache,
    movedToLibrary,
    bytesInCache,
    committingBatches,
    samples,
  };
}
