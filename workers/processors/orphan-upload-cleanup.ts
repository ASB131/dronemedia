import { Worker } from "bullmq";

import { loadConfig } from "@/lib/config";
import { JOB_NAMES } from "@/lib/jobs/types";
import { getLogger } from "@/lib/logger";
import { cleanupOrphanUploads } from "@/lib/upload/orphan-cleanup";

const logger = getLogger().child({ worker: JOB_NAMES.ORPHAN_UPLOAD_CLEANUP });

export function createOrphanUploadCleanupWorker(connection: { url: string }) {
  const worker = new Worker(
    JOB_NAMES.ORPHAN_UPLOAD_CLEANUP,
    async () => cleanupOrphanUploads(),
    {
      connection,
      concurrency: 1,
    },
  );

  worker.on("failed", (_job, error) => {
    logger.error({ err: error }, "Orphan upload cleanup job failed");
  });

  return worker;
}

export async function scheduleOrphanUploadCleanup(connection: {
  url: string;
}) {
  const config = loadConfig();
  const { Queue } = await import("bullmq");
  const queue = new Queue(JOB_NAMES.ORPHAN_UPLOAD_CLEANUP, { connection });

  await queue.upsertJobScheduler(
    "hourly-orphan-upload-cleanup",
    { pattern: config.nightly.orphanUploadCleanupCron },
    { name: "orphanUploadCleanup", data: {} },
  );

  await queue.close();
}
