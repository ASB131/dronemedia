import { Worker } from "bullmq";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";

import { loadConfig } from "@/lib/config";
import { getWorkerDb } from "@/lib/db";
import { assets, jobFailures, luts, sequenceFrames } from "@/lib/db/schema";
import { publishJobEvent } from "@/lib/jobs/enqueue";
import { getMetadataQueue } from "@/lib/jobs/queues";
import { JOB_NAMES, type AssetJobData } from "@/lib/jobs/types";
import { getLogger } from "@/lib/logger";
import { getStorageAdapter } from "@/lib/storage";
import { extractVideoThumbnailWebp } from "../lib/ffmpeg";
import { localMediaPath } from "../lib/media-path";
import { readMediaFile, readSequenceFrameByKey } from "../lib/storage";
import { thumbnailCacheKey, photoWebPreviewCacheKey } from "../lib/thumbnails";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const logger = getLogger().child({ worker: JOB_NAMES.THUMBNAILS });

async function writePlaceholder(
  userId: string,
  assetId: string,
  label: string,
): Promise<void> {
  const storage = getStorageAdapter();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
    <rect width="100%" height="100%" fill="#1f2937"/>
    <text x="50%" y="50%" fill="#ffffff" font-size="28" text-anchor="middle" dominant-baseline="middle">${label}</text>
  </svg>`;
  const webp = await sharp(Buffer.from(svg)).webp({ quality: 70 }).toBuffer();
  await storage.put(thumbnailCacheKey(userId, assetId), webp, {
    tier: "cache",
    contentType: "image/webp",
  });
}

export function createThumbnailsWorker(connection: { url: string }) {
  const workerConfig = loadConfig();

  const worker = new Worker<AssetJobData>(
    JOB_NAMES.THUMBNAILS,
    async (job) => {
      const config = loadConfig(true);
      const { userId, assetId } = job.data;
      const db = getWorkerDb();
      const storage = getStorageAdapter();

      await publishJobEvent({
        userId,
        jobType: JOB_NAMES.THUMBNAILS,
        assetId,
        status: "processing",
        timestamp: new Date().toISOString(),
      });

      const [asset] = await db
        .select()
        .from(assets)
        .where(eq(assets.id, assetId))
        .limit(1);

      if (!asset) {
        throw new Error(`Asset ${assetId} not found`);
      }

      const key = thumbnailCacheKey(userId, assetId);

      if (asset.assetType === "photo") {
        const media = await readMediaFile(userId, assetId, asset.mainFileExt);
        if (!media) {
          throw new Error("Main media file not found on disk");
        }
        const webp = await sharp(media)
          .rotate()
          .resize(config.images.thumbnailMaxEdge, config.images.thumbnailMaxEdge, {
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: config.images.thumbnailQuality })
          .toBuffer();
        await storage.put(key, webp, { tier: "cache", contentType: "image/webp" });

        const preview = await sharp(media)
          .rotate()
          .resize(config.images.webMaxEdge, config.images.webMaxEdge, {
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: config.images.webQuality })
          .toBuffer();
        await storage.put(photoWebPreviewCacheKey(userId, assetId), preview, {
          tier: "cache",
          contentType: "image/webp",
        });

        try {
          const { computeAverageHash } = await import("../lib/phash");
          const perceptualHash = await computeAverageHash(media);
          await db
            .update(assets)
            .set({ perceptualHash, updatedAt: new Date() })
            .where(eq(assets.id, assetId));
        } catch (error) {
          logger.warn({ assetId, err: error }, "perceptual hash failed");
        }
      } else if (asset.assetType === "sequence") {
        const [frame] = await db
          .select()
          .from(sequenceFrames)
          .where(
            and(
              eq(sequenceFrames.assetId, assetId),
              eq(sequenceFrames.frameIndex, 0),
            ),
          )
          .limit(1);

        if (!frame) {
          await writePlaceholder(userId, assetId, "Sequence");
        } else {
          const media = await readSequenceFrameByKey(frame.storageKey);
          if (!media) {
            await writePlaceholder(userId, assetId, "Sequence");
          } else {
            const webp = await sharp(media)
              .rotate()
              .resize(
                config.images.thumbnailMaxEdge,
                config.images.thumbnailMaxEdge,
                { fit: "inside", withoutEnlargement: true },
              )
              .webp({ quality: config.images.thumbnailQuality })
              .toBuffer();
            await storage.put(key, webp, {
              tier: "cache",
              contentType: "image/webp",
            });

            try {
              const { computeAverageHash } = await import("../lib/phash");
              const perceptualHash = await computeAverageHash(media);
              await db
                .update(assets)
                .set({ perceptualHash, updatedAt: new Date() })
                .where(eq(assets.id, assetId));
            } catch (error) {
              logger.warn({ assetId, err: error }, "perceptual hash failed");
            }
          }
        }
      } else {
        const inputPath = localMediaPath(userId, assetId, asset.mainFileExt);
        let lutTempPath: string | null = null;
        let lutTempDir: string | null = null;
        try {
          if (asset.preferredLutId) {
            const [lut] = await db
              .select()
              .from(luts)
              .where(eq(luts.id, asset.preferredLutId))
              .limit(1);
            if (lut) {
              const cube = await storage.get(lut.storageKey, { tier: "app" });
              if (cube) {
                lutTempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dm-lut-"));
                lutTempPath = path.join(lutTempDir, "grade.cube");
                await fs.writeFile(lutTempPath, cube);
              }
            }
          }

          const webp = await extractVideoThumbnailWebp(inputPath, {
            maxEdge: config.images.thumbnailMaxEdge,
            quality: config.images.thumbnailQuality,
            lutCubePath: lutTempPath,
          });
          if (webp) {
            await storage.put(key, webp, {
              tier: "cache",
              contentType: "image/webp",
            });
          } else {
            logger.warn(
              { assetId, inputPath },
              "Video frame extract failed; writing placeholder",
            );
            await writePlaceholder(userId, assetId, "Video");
          }
        } catch (error) {
          logger.warn(
            { assetId, err: error },
            "Video thumbnail unexpected error; writing placeholder",
          );
          await writePlaceholder(userId, assetId, "Video");
        } finally {
          if (lutTempDir) {
            await fs
              .rm(lutTempDir, { recursive: true, force: true })
              .catch(() => undefined);
          }
        }
      }

      await getMetadataQueue().add(
        "metadata",
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
        jobType: JOB_NAMES.METADATA,
        assetId,
        status: "queued",
        timestamp: new Date().toISOString(),
      });

      await publishJobEvent({
        userId,
        jobType: JOB_NAMES.THUMBNAILS,
        assetId,
        status: "complete",
        timestamp: new Date().toISOString(),
      });

      return { assetId };
    },
    {
      connection,
      concurrency: workerConfig.jobs.concurrency.thumbnails,
    },
  );

  worker.on("failed", async (job, error) => {
    if (!job) return;
    const db = getWorkerDb();
    await db.insert(jobFailures).values({
      jobType: JOB_NAMES.THUMBNAILS,
      entityType: "asset",
      entityId: job.data.assetId,
      errorDetail: error.message,
      attemptCount: job.attemptsMade,
      payload: job.data as unknown as Record<string, unknown>,
    });
    await publishJobEvent({
      userId: job.data.userId,
      jobType: JOB_NAMES.THUMBNAILS,
      assetId: job.data.assetId,
      status: "failed",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  });

  return worker;
}
