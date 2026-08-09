import { desc, eq, isNull } from "drizzle-orm";

import { getWebDb, getWorkerDb } from "@/lib/db";
import {
  assetFiles,
  assets,
  integrityCheckRuns,
  type IntegrityIssueRow,
} from "@/lib/db/schema";
import { hashFileStream } from "@/lib/hash";
import { getLogger } from "@/lib/logger";
import { buildMediaAssetKey, getStorageAdapter } from "@/lib/storage";

const logger = getLogger().child({ module: "integrity-check" });

export type IntegrityIssue = IntegrityIssueRow;

export type IntegrityCheckResult = {
  runId: string;
  checked: number;
  missing: number;
  hashMismatch: number;
  issues: IntegrityIssue[];
};

export type IntegrityRunDto = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  checkedCount: number;
  missingCount: number;
  hashMismatchCount: number;
  issues: IntegrityIssue[];
  triggeredBy: string;
  errorDetail: string | null;
};

const BATCH_SIZE = 50;

export async function runIntegrityCheck(options?: {
  triggeredBy?: string;
}): Promise<IntegrityCheckResult> {
  const db = getWorkerDb();
  const storage = getStorageAdapter();
  const triggeredBy = options?.triggeredBy ?? "cron";

  const [run] = await db
    .insert(integrityCheckRuns)
    .values({
      status: "running",
      triggeredBy,
    })
    .returning();

  try {
    const rows = await db
      .select({
        assetId: assetFiles.assetId,
        userId: assetFiles.userId,
        extension: assetFiles.extension,
        contentHash: assetFiles.contentHash,
      })
      .from(assetFiles)
      .innerJoin(assets, eq(assets.id, assetFiles.assetId))
      .where(isNull(assets.deletedAt));

    const issues: IntegrityIssue[] = [];
    let checked = 0;
    let missing = 0;
    let hashMismatch = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      for (const row of batch) {
        checked += 1;
        const key = buildMediaAssetKey(row.userId, row.assetId, row.extension);
        const exists = await storage.exists(key, { tier: "media" });
        if (!exists) {
          missing += 1;
          issues.push({
            assetId: row.assetId,
            userId: row.userId,
            extension: row.extension,
            reason: "missing",
          });
          continue;
        }

        const stream = await storage.getStream(key, { tier: "media" });
        if (!stream) {
          missing += 1;
          issues.push({
            assetId: row.assetId,
            userId: row.userId,
            extension: row.extension,
            reason: "missing",
          });
          continue;
        }

        const { hash } = await hashFileStream(stream);
        if (hash !== row.contentHash) {
          hashMismatch += 1;
          issues.push({
            assetId: row.assetId,
            userId: row.userId,
            extension: row.extension,
            reason: "hash_mismatch",
            expectedHash: row.contentHash,
            actualHash: hash,
          });
        }
      }
    }

    await db
      .update(integrityCheckRuns)
      .set({
        status: "complete",
        finishedAt: new Date(),
        checkedCount: checked,
        missingCount: missing,
        hashMismatchCount: hashMismatch,
        issues,
      })
      .where(eq(integrityCheckRuns.id, run.id));

    logger.info(
      {
        runId: run.id,
        checked,
        missing,
        hashMismatch,
        issueCount: issues.length,
      },
      "Integrity check complete",
    );
    if (issues.length > 0) {
      logger.warn({ issues: issues.slice(0, 50) }, "Integrity issues detected");
    }

    return {
      runId: run.id,
      checked,
      missing,
      hashMismatch,
      issues,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await db
      .update(integrityCheckRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errorDetail: message,
      })
      .where(eq(integrityCheckRuns.id, run.id));
    throw error;
  }
}

export async function listIntegrityRuns(limit = 20): Promise<IntegrityRunDto[]> {
  const db = getWebDb();
  const rows = await db
    .select()
    .from(integrityCheckRuns)
    .orderBy(desc(integrityCheckRuns.startedAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    status: row.status,
    checkedCount: row.checkedCount,
    missingCount: row.missingCount,
    hashMismatchCount: row.hashMismatchCount,
    issues: row.issues ?? [],
    triggeredBy: row.triggeredBy,
    errorDetail: row.errorDetail,
  }));
}

export async function getLatestIntegrityRun(): Promise<IntegrityRunDto | null> {
  const runs = await listIntegrityRuns(1);
  return runs[0] ?? null;
}
