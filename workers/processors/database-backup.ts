import { Worker } from "bullmq";

import { runDatabaseBackup } from "@/lib/admin/backup";
import { loadConfig } from "@/lib/config";
import { JOB_NAMES } from "@/lib/jobs/types";
import { getLogger } from "@/lib/logger";

const logger = getLogger().child({ worker: JOB_NAMES.DATABASE_BACKUP });

export function createDatabaseBackupWorker(connection: { url: string }) {
  const worker = new Worker(
    JOB_NAMES.DATABASE_BACKUP,
    async () => {
      const result = await runDatabaseBackup();
      logger.info(result, "Scheduled database backup complete");
      return result;
    },
    { connection, concurrency: 1 },
  );

  worker.on("failed", (_job, error) => {
    logger.error({ err: error }, "Database backup job failed");
  });

  return worker;
}

export async function scheduleDatabaseBackup(connection: { url: string }) {
  const config = loadConfig();
  if (!config.backup.enabled) return;

  const { Queue } = await import("bullmq");
  const queue = new Queue(JOB_NAMES.DATABASE_BACKUP, { connection });

  await queue.upsertJobScheduler(
    "scheduled-database-backup",
    { pattern: config.backup.cron },
    { name: "databaseBackup", data: {} },
  );

  await queue.close();
}
