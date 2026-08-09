import { Worker } from "bullmq";

import { purgeExpiredBinItems } from "@/lib/assets/bin-cleanup";
import { loadConfig } from "@/lib/config";
import { JOB_NAMES } from "@/lib/jobs/types";
import { getLogger } from "@/lib/logger";

const logger = getLogger().child({ worker: JOB_NAMES.BIN_CLEANUP });

export function createBinCleanupWorker(connection: { url: string }) {
  const config = loadConfig();

  const worker = new Worker(
    JOB_NAMES.BIN_CLEANUP,
    async () => {
      const purged = await purgeExpiredBinItems(config.bin.purgeAfterDays);
      return { purged };
    },
    {
      connection,
      concurrency: 1,
    },
  );

  worker.on("failed", (_job, error) => {
    logger.error({ err: error }, "Bin cleanup job failed");
  });

  return worker;
}

export async function scheduleBinCleanup(connection: { url: string }) {
  const config = loadConfig();
  const { Queue } = await import("bullmq");
  const queue = new Queue(JOB_NAMES.BIN_CLEANUP, { connection });

  await queue.upsertJobScheduler(
    "nightly-bin-cleanup",
    { pattern: config.nightly.binCleanupCron },
    { name: "binCleanup", data: {} },
  );

  await queue.close();
}
