import fs from "node:fs/promises";
import path from "node:path";

import { and, eq, inArray, isNotNull, isNull, lt, notInArray, or } from "drizzle-orm";

import { loadConfig } from "@/lib/config";
import { getWorkerDb } from "@/lib/db";
import { uploadBatches, uploadFiles } from "@/lib/db/schema";
import { getLogger } from "@/lib/logger";
import { getStorageAdapter } from "@/lib/storage";
import { uploadStagingPrefix } from "@/lib/upload/paths";

const logger = getLogger().child({ module: "orphan-upload-cleanup" });

/** Assembled-but-never-committed uploads are purged sooner than in-progress ones. */
const COMPLETE_UNCOMMITTED_TTL_MS = 6 * 60 * 60 * 1000;

async function deleteStagingForFile(
  storage: ReturnType<typeof getStorageAdapter>,
  userId: string,
  fileId: string,
  stagingPrefix: string | null,
) {
  const prefix = stagingPrefix || uploadStagingPrefix(userId, fileId);
  return storage.deletePrefix(prefix, { tier: "cache" });
}

export async function cleanupOrphanUploads() {
  const db = getWorkerDb();
  const storage = getStorageAdapter();
  const now = new Date();
  const completeCutoff = new Date(now.getTime() - COMPLETE_UNCOMMITTED_TTL_MS);

  // 1) Expired incomplete uploads (TTL from batch create), or complete-but-uncommitted past 6h.
  const expiredFiles = await db
    .select({
      id: uploadFiles.id,
      userId: uploadFiles.userId,
      batchId: uploadFiles.batchId,
      stagingPrefix: uploadFiles.stagingPrefix,
      totalChunks: uploadFiles.totalChunks,
    })
    .from(uploadFiles)
    .where(
      and(
        isNull(uploadFiles.assetId),
        notInArray(uploadFiles.status, ["cancelled"]),
        or(
          lt(uploadFiles.expiresAt, now),
          and(
            eq(uploadFiles.status, "complete"),
            lt(uploadFiles.updatedAt, completeCutoff),
          ),
        ),
      ),
    );

  let cleanedFiles = 0;
  const touchedBatchIds = new Set<string>();

  for (const file of expiredFiles) {
    await deleteStagingForFile(
      storage,
      file.userId,
      file.id,
      file.stagingPrefix,
    );

    await db
      .update(uploadFiles)
      .set({
        status: "cancelled",
        errorMessage: "Expired incomplete upload cleaned up",
        updatedAt: new Date(),
      })
      .where(eq(uploadFiles.id, file.id));

    touchedBatchIds.add(file.batchId);
    cleanedFiles += 1;
  }

  // 2) Post-commit leftovers: asset linked but staging dir may still hold chunks.
  const committedFiles = await db
    .select({
      id: uploadFiles.id,
      userId: uploadFiles.userId,
      stagingPrefix: uploadFiles.stagingPrefix,
    })
    .from(uploadFiles)
    .where(isNotNull(uploadFiles.assetId));

  let cleanedCommittedStaging = 0;
  for (const file of committedFiles) {
    const deleted = await deleteStagingForFile(
      storage,
      file.userId,
      file.id,
      file.stagingPrefix,
    );
    if (deleted > 0) cleanedCommittedStaging += 1;
  }

  // 3) Disk orphans under cache/uploads with no keep-alive DB row.
  const diskOrphans = await cleanupDiskOrphanStaging();

  let cancelledBatches = 0;
  if (touchedBatchIds.size > 0) {
    const batchIds = [...touchedBatchIds];
    for (const batchId of batchIds) {
      const remaining = await db
        .select({ id: uploadFiles.id })
        .from(uploadFiles)
        .where(
          and(
            eq(uploadFiles.batchId, batchId),
            notInArray(uploadFiles.status, ["cancelled"]),
            isNull(uploadFiles.assetId),
          ),
        )
        .limit(1);

      if (remaining.length > 0) continue;

      const [updated] = await db
        .update(uploadBatches)
        .set({
          status: "cancelled",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(uploadBatches.id, batchId),
            inArray(uploadBatches.status, ["open", "committing"]),
          ),
        )
        .returning({ id: uploadBatches.id });

      if (updated) cancelledBatches += 1;
    }
  }

  logger.info(
    {
      cleanedFiles,
      cleanedCommittedStaging,
      diskOrphans,
      cancelledBatches,
    },
    "Orphan upload cleanup complete",
  );

  return {
    cleanedFiles,
    cleanedCommittedStaging,
    diskOrphans,
    cancelledBatches,
  };
}

/**
 * Remove cache/uploads/{userId}/{fileId} dirs that are not tied to an active
 * (non-cancelled, not-yet-committed) upload row.
 */
export async function cleanupDiskOrphanStaging(): Promise<number> {
  const config = loadConfig();
  const storage = getStorageAdapter();
  const db = getWorkerDb();
  const uploadsRoot = path.join(config.storage.cachePath, "uploads");

  let entries: string[];
  try {
    entries = await fs.readdir(uploadsRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }

  const keepRows = await db
    .select({
      id: uploadFiles.id,
      userId: uploadFiles.userId,
    })
    .from(uploadFiles)
    .where(
      and(
        isNull(uploadFiles.assetId),
        notInArray(uploadFiles.status, ["cancelled"]),
      ),
    );
  const keep = new Set(keepRows.map((row) => `${row.userId}/${row.id}`));

  let removed = 0;
  for (const userId of entries) {
    const userDir = path.join(uploadsRoot, userId);
    let fileIds: string[];
    try {
      const stat = await fs.stat(userDir);
      if (!stat.isDirectory()) continue;
      fileIds = await fs.readdir(userDir);
    } catch {
      continue;
    }

    for (const fileId of fileIds) {
      const key = `${userId}/${fileId}`;
      if (keep.has(key)) continue;
      await storage.deletePrefix(uploadStagingPrefix(userId, fileId), {
        tier: "cache",
      });
      removed += 1;
    }

    // Drop empty user folders.
    try {
      const remaining = await fs.readdir(userDir);
      if (remaining.length === 0) {
        await fs.rmdir(userDir);
      }
    } catch {
      // ignore
    }
  }

  return removed;
}
