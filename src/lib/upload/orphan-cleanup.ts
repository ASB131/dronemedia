import fs from "node:fs/promises";
import path from "node:path";

import { and, eq, inArray, isNotNull, isNull, lt, notInArray, or } from "drizzle-orm";

import { loadConfig } from "@/lib/config";
import { getWorkerDb } from "@/lib/db";
import { uploadBatches, uploadFiles } from "@/lib/db/schema";
import { getLogger } from "@/lib/logger";
import { getStorageAdapter } from "@/lib/storage";
import { uploadStagingPrefix } from "@/lib/upload/paths";
import {
  COMPLETE_UNCOMMITTED_TTL_MS,
  FAILED_UPLOAD_TTL_MS,
} from "@/lib/upload/ttl";

const logger = getLogger().child({ module: "orphan-upload-cleanup" });

export { FAILED_UPLOAD_TTL_MS };

async function dirSizeBytes(root: string): Promise<number> {
  let total = 0;
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(full);
          total += stat.size;
        } catch {
          // skip
        }
      }
    }
  }
  await walk(root);
  return total;
}

async function deleteStagingForFile(
  storage: ReturnType<typeof getStorageAdapter>,
  userId: string,
  fileId: string,
  stagingPrefix: string | null,
): Promise<{ deleted: number; bytesFreed: number }> {
  const prefix = stagingPrefix || uploadStagingPrefix(userId, fileId);
  const config = loadConfig();
  const abs = path.join(config.storage.cachePath, prefix);
  let bytesFreed = 0;
  try {
    bytesFreed = await dirSizeBytes(abs);
  } catch {
    bytesFreed = 0;
  }
  const deleted = await storage.deletePrefix(prefix, { tier: "cache" });
  return { deleted, bytesFreed: deleted > 0 ? bytesFreed : 0 };
}

export async function cleanupOrphanUploads() {
  const db = getWorkerDb();
  const storage = getStorageAdapter();
  const config = loadConfig();
  const uploadsRoot = path.join(config.storage.cachePath, "uploads");
  const bytesBefore = await dirSizeBytes(uploadsRoot);

  const now = new Date();
  const completeCutoff = new Date(now.getTime() - COMPLETE_UNCOMMITTED_TTL_MS);
  const failedCutoff = new Date(now.getTime() - FAILED_UPLOAD_TTL_MS);

  // 1) Expired incomplete uploads (TTL from batch create), complete-but-uncommitted
  // past 6h, or failed (commit/assemble) past 2h.
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
          and(
            eq(uploadFiles.status, "failed"),
            lt(uploadFiles.updatedAt, failedCutoff),
          ),
        ),
      ),
    );

  let cleanedFiles = 0;
  let bytesFreedTracked = 0;
  const touchedBatchIds = new Set<string>();

  for (const file of expiredFiles) {
    const { bytesFreed } = await deleteStagingForFile(
      storage,
      file.userId,
      file.id,
      file.stagingPrefix,
    );
    bytesFreedTracked += bytesFreed;

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
    const { deleted, bytesFreed } = await deleteStagingForFile(
      storage,
      file.userId,
      file.id,
      file.stagingPrefix,
    );
    if (deleted > 0) {
      cleanedCommittedStaging += 1;
      bytesFreedTracked += bytesFreed;
    }
  }

  // 3) Disk orphans under cache/uploads with no keep-alive DB row.
  const diskOrphans = await cleanupDiskOrphanStaging();

  // 4) Always prune empty uploads/{userId} (and empty parents).
  const emptyDirsPruned = await pruneEmptyUploadDirs();

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

  const bytesAfter = await dirSizeBytes(uploadsRoot);
  const bytesFreed = Math.max(bytesBefore - bytesAfter, bytesFreedTracked);

  logger.info(
    {
      cleanedFiles,
      cleanedCommittedStaging,
      diskOrphans,
      emptyDirsPruned,
      cancelledBatches,
      bytesFreed,
    },
    "Orphan upload cleanup complete",
  );

  return {
    cleanedFiles,
    cleanedCommittedStaging,
    diskOrphans,
    emptyDirsPruned,
    cancelledBatches,
    bytesFreed,
    uploadsBytesBefore: bytesBefore,
    uploadsBytesAfter: bytesAfter,
  };
}

/**
 * Remove empty uploads/{userId} directories (and nested empty session dirs).
 */
export async function pruneEmptyUploadDirs(): Promise<number> {
  const config = loadConfig();
  const uploadsRoot = path.join(config.storage.cachePath, "uploads");

  let pruned = 0;
  let userIds: string[];
  try {
    userIds = await fs.readdir(uploadsRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }

  for (const userId of userIds) {
    const userDir = path.join(uploadsRoot, userId);
    let children: string[];
    try {
      const stat = await fs.stat(userDir);
      if (!stat.isDirectory()) continue;
      children = await fs.readdir(userDir);
    } catch {
      continue;
    }

    for (const child of children) {
      const childPath = path.join(userDir, child);
      try {
        const childStat = await fs.stat(childPath);
        if (!childStat.isDirectory()) continue;
        const nested = await fs.readdir(childPath);
        if (nested.length === 0) {
          await fs.rmdir(childPath);
          pruned += 1;
        }
      } catch {
        // ignore
      }
    }

    try {
      const remaining = await fs.readdir(userDir);
      if (remaining.length === 0) {
        await fs.rmdir(userDir);
        pruned += 1;
      }
    } catch {
      // ignore
    }
  }

  return pruned;
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
  }

  return removed;
}
