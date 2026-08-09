import { Worker } from "bullmq";
import { eq } from "drizzle-orm";

import { runIntegrityCheck } from "@/lib/assets/integrity-check";
import { loadConfig } from "@/lib/config";
import { getWorkerDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { JOB_NAMES } from "@/lib/jobs/types";
import { cleanupLibraryOrphans } from "@/lib/library/orphan-cleanup";
import { getLogger } from "@/lib/logger";

const logger = getLogger().child({ worker: JOB_NAMES.INTEGRITY_CHECK });

export function createIntegrityCheckWorker(connection: { url: string }) {
  const worker = new Worker<{ triggeredBy?: string }>(
    JOB_NAMES.INTEGRITY_CHECK,
    async (job) => {
      const result = await runIntegrityCheck({
        triggeredBy: job.data?.triggeredBy ?? "cron",
      });
      // Library orphan cleanup moved off the flights list path.
      try {
        const db = getWorkerDb();
        const approved = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.approvalStatus, "approved"));
        for (const user of approved) {
          await cleanupLibraryOrphans(user.id);
        }
      } catch (error) {
        logger.warn({ err: error }, "Library orphan cleanup after integrity failed");
      }
      return result;
    },
    {
      connection,
      concurrency: 1,
    },
  );

  worker.on("failed", (_job, error) => {
    logger.error({ err: error }, "Integrity check job failed");
  });

  return worker;
}

export async function scheduleIntegrityCheck(connection: { url: string }) {
  const config = loadConfig();
  const { Queue } = await import("bullmq");
  const queue = new Queue(JOB_NAMES.INTEGRITY_CHECK, { connection });

  await queue.upsertJobScheduler(
    "weekly-integrity-check",
    { pattern: config.nightly.integrityCheckCron },
    { name: "integrityCheck", data: { triggeredBy: "cron" } },
  );

  await queue.close();
}
