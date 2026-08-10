import { getRedisUrl } from "@/lib/config";
import { closeDbPools } from "@/lib/db";
import { closeQueues } from "@/lib/jobs/queues";
import { getLogger } from "@/lib/logger";
import { getRedis } from "@/lib/redis";
import {
  createBinCleanupWorker,
  scheduleBinCleanup,
} from "./processors/bin-cleanup";
import {
  createDatabaseBackupWorker,
  scheduleDatabaseBackup,
} from "./processors/database-backup";
import {
  createIntegrityCheckWorker,
  scheduleIntegrityCheck,
} from "./processors/integrity-check";
import {
  createOrphanUploadCleanupWorker,
  scheduleOrphanUploadCleanup,
} from "./processors/orphan-upload-cleanup";
import {
  createDedupWorker,
  createMetadataWorker,
  createPanoramaStitchWorker,
  createSequenceExportWorker,
  createSrtFlightPathWorker,
  createThumbnailsWorker,
  createWebTranscodingWorker,
} from "./processors";

const logger = getLogger().child({ module: "worker" });

async function main() {
  logger.info("Drone Media worker process starting");

  const redis = getRedis();
  await redis.connect();
  logger.info({ status: redis.status }, "Redis connected");

  const connection = { url: getRedisUrl() };
  await scheduleBinCleanup(connection);
  await scheduleOrphanUploadCleanup(connection);
  await scheduleIntegrityCheck(connection);
  await scheduleDatabaseBackup(connection);

  try {
    const { syncGateQueuePausedState } = await import("@/lib/jobs/gates");
    await syncGateQueuePausedState();
    logger.info("Synced job gate pause state from config");
  } catch (error) {
    logger.warn({ err: error }, "Could not sync job gate pause state");
  }

  const workers = [
    createDedupWorker(connection),
    createThumbnailsWorker(connection),
    createMetadataWorker(connection),
    createSrtFlightPathWorker(connection),
    createWebTranscodingWorker(connection),
    createPanoramaStitchWorker(connection),
    createSequenceExportWorker(connection),
    createBinCleanupWorker(connection),
    createOrphanUploadCleanupWorker(connection),
    createIntegrityCheckWorker(connection),
    createDatabaseBackupWorker(connection),
  ];

  logger.info(
    { queues: workers.map((w) => w.name) },
    "BullMQ workers registered",
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Graceful shutdown initiated");
    await Promise.all(workers.map((w) => w.close()));
    await closeQueues();
    await redis.quit();
    await closeDbPools();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  logger.fatal({ err: error }, "Worker failed to start");
  process.exit(1);
});
