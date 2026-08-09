import { Worker } from "bullmq";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { loadConfig } from "@/lib/config";
import { getWorkerDb } from "@/lib/db";
import { assetFiles, assets, jobFailures } from "@/lib/db/schema";
import { hashFileStream } from "@/lib/hash";
import { publishJobEvent } from "@/lib/jobs/enqueue";
import { getThumbnailsQueue } from "@/lib/jobs/queues";
import { JOB_NAMES, type DedupJobData } from "@/lib/jobs/types";
import { getLogger } from "@/lib/logger";
import { streamMediaFile } from "../lib/storage";

const logger = getLogger().child({ worker: JOB_NAMES.DEDUP });

export function createDedupWorker(connection: { url: string }) {
  const config = loadConfig();

  const worker = new Worker<DedupJobData>(
    JOB_NAMES.DEDUP,
    async (job) => {
      const { userId, assetId, onDuplicate } = job.data;
      const db = getWorkerDb();

      await publishJobEvent({
        userId,
        jobType: JOB_NAMES.DEDUP,
        assetId,
        status: "processing",
        timestamp: new Date().toISOString(),
      });

      const assetRows = await db
        .select({ id: assets.id })
        .from(assets)
        .where(eq(assets.id, assetId))
        .limit(1);

      if (!assetRows[0]) {
        throw new Error(`Asset ${assetId} not found`);
      }

      const files = await db
        .select()
        .from(assetFiles)
        .where(eq(assetFiles.assetId, assetId));

      for (const file of files) {
        const digests = new Set<string>([file.contentHash]);

        // Recompute both digests from media so xxhash↔sha256 switches still match.
        const media = await streamMediaFile(userId, assetId, file.extension);
        if (media) {
          const hashed = await hashFileStream(media);
          digests.add(hashed.digests.xxhash);
          digests.add(hashed.digests.sha256);
        }

        const existing = await db
          .select({ assetId: assetFiles.assetId })
          .from(assetFiles)
          .innerJoin(assets, eq(assets.id, assetFiles.assetId))
          .where(
            and(
              eq(assetFiles.userId, userId),
              inArray(assetFiles.contentHash, [...digests]),
              isNull(assets.deletedAt),
            ),
          );

        const match = existing.find((row) => row.assetId !== assetId);
        if (!match) continue;

        logger.info(
          { assetId, duplicateOf: match.assetId, onDuplicate },
          "Duplicate content detected",
        );

        if (onDuplicate === "flag") {
          await db
            .update(assets)
            .set({
              description: `Possible duplicate of asset ${match.assetId}`,
              updatedAt: new Date(),
            })
            .where(eq(assets.id, assetId));
        }
      }

      await getThumbnailsQueue().add(
        "thumbnails",
        { userId, assetId },
        {
          attempts: config.jobs.retry.attempts,
          backoff: {
            type: "exponential",
            delay: config.jobs.retry.backoffMs,
          },
        },
      );

      await publishJobEvent({
        userId,
        jobType: JOB_NAMES.THUMBNAILS,
        assetId,
        status: "queued",
        timestamp: new Date().toISOString(),
      });

      await publishJobEvent({
        userId,
        jobType: JOB_NAMES.DEDUP,
        assetId,
        status: "complete",
        timestamp: new Date().toISOString(),
      });

      return { assetId, status: "complete" };
    },
    {
      connection,
      concurrency: config.jobs.concurrency.dedup,
    },
  );

  worker.on("failed", async (job, error) => {
    if (!job) return;
    const db = getWorkerDb();
    await db.insert(jobFailures).values({
      jobType: JOB_NAMES.DEDUP,
      entityType: "asset",
      entityId: job.data.assetId,
      errorDetail: error.message,
      attemptCount: job.attemptsMade,
      payload: job.data as unknown as Record<string, unknown>,
    });

    await publishJobEvent({
      userId: job.data.userId,
      jobType: JOB_NAMES.DEDUP,
      assetId: job.data.assetId,
      status: "failed",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  });

  return worker;
}
