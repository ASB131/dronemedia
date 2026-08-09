import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Worker } from "bullmq";
import { asc, eq } from "drizzle-orm";

import { sequenceFullResExportKey } from "@/lib/assets/transcoding";
import { loadConfig } from "@/lib/config";
import { getWorkerDb } from "@/lib/db";
import { assets, jobFailures, sequenceFrames } from "@/lib/db/schema";
import { publishJobEvent } from "@/lib/jobs/enqueue";
import { JOB_NAMES, type AssetJobData } from "@/lib/jobs/types";
import { getLogger } from "@/lib/logger";
import { getStorageAdapter } from "@/lib/storage";
import { ffmpegAvailable } from "../lib/ffmpeg";
import { withFfmpegLock } from "../lib/ffmpeg-mutex";
import { localSequenceFramePath } from "../lib/media-path";
import { stitchSequenceMp4 } from "../lib/sequence-stitch";

const logger = getLogger().child({ worker: JOB_NAMES.SEQUENCE_EXPORT });

export function createSequenceExportWorker(connection: { url: string }) {
  const config = loadConfig();

  const worker = new Worker<AssetJobData>(
    JOB_NAMES.SEQUENCE_EXPORT,
    async (job) => {
      const { userId, assetId } = job.data;
      const db = getWorkerDb();
      const storage = getStorageAdapter();

      await publishJobEvent({
        userId,
        jobType: JOB_NAMES.SEQUENCE_EXPORT,
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

      if (asset.assetType !== "sequence") {
        await publishJobEvent({
          userId,
          jobType: JOB_NAMES.SEQUENCE_EXPORT,
          assetId,
          status: "complete",
          message: "Skipped — not a sequence asset",
          timestamp: new Date().toISOString(),
        });
        return { assetId, skipped: true };
      }

      if (asset.sequenceKind === "panorama") {
        await publishJobEvent({
          userId,
          jobType: JOB_NAMES.SEQUENCE_EXPORT,
          assetId,
          status: "complete",
          message: "Skipped — panoramas do not export as MP4",
          timestamp: new Date().toISOString(),
        });
        return { assetId, skipped: true };
      }

      const exportKey = sequenceFullResExportKey(userId, assetId);
      if (await storage.exists(exportKey, { tier: "cache" })) {
        await publishJobEvent({
          userId,
          jobType: JOB_NAMES.SEQUENCE_EXPORT,
          assetId,
          status: "complete",
          message: "Full-res export already exists",
          timestamp: new Date().toISOString(),
        });
        return { assetId, skipped: true };
      }

      if (!(await ffmpegAvailable())) {
        throw new Error("ffmpeg not available for sequence export");
      }

      const frames = await db
        .select()
        .from(sequenceFrames)
        .where(eq(sequenceFrames.assetId, assetId))
        .orderBy(asc(sequenceFrames.frameIndex));

      if (frames.length === 0) {
        throw new Error("Sequence has no frames");
      }

      const framePaths: string[] = [];
      for (const frame of frames) {
        const ext =
          path.extname(frame.filename).replace(/^\./, "").toLowerCase() ||
          "jpg";
        const framePath = localSequenceFramePath(
          userId,
          assetId,
          frame.frameIndex,
          ext,
        );
        await fs.access(framePath);
        framePaths.push(framePath);
      }

      await withFfmpegLock(async () => {
        const tempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), "dm-seq-export-"),
        );
        try {
          const outputPath = path.join(tempDir, "fullres.mp4");
          await stitchSequenceMp4({
            framePaths,
            outputPath,
            quality: "fullres",
            fps: asset.sequenceFps ?? undefined,
          });
          await storage.put(exportKey, createReadStream(outputPath), {
            tier: "cache",
            contentType: "video/mp4",
          });
        } finally {
          await fs.rm(tempDir, { recursive: true, force: true });
        }
      });

      await publishJobEvent({
        userId,
        jobType: JOB_NAMES.SEQUENCE_EXPORT,
        assetId,
        status: "complete",
        timestamp: new Date().toISOString(),
      });

      logger.info({ assetId, frames: framePaths.length }, "Sequence full-res export complete");
      return { assetId };
    },
    {
      connection,
      concurrency: config.jobs.concurrency.sequenceExport ?? 1,
    },
  );

  worker.on("failed", async (job, error) => {
    if (!job) return;
    const db = getWorkerDb();
    await db.insert(jobFailures).values({
      jobType: JOB_NAMES.SEQUENCE_EXPORT,
      entityType: "asset",
      entityId: job.data.assetId,
      errorDetail: error.message,
      attemptCount: job.attemptsMade,
      payload: job.data as unknown as Record<string, unknown>,
    });
    await publishJobEvent({
      userId: job.data.userId,
      jobType: JOB_NAMES.SEQUENCE_EXPORT,
      assetId: job.data.assetId,
      status: "failed",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  });

  return worker;
}
