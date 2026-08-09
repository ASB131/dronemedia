import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Worker } from "bullmq";
import { asc, eq } from "drizzle-orm";

import {
  videoHlsPlaylistKey,
  videoHlsPrefix,
  videoHlsSegmentKey,
} from "@/lib/assets/hls";
import { setAssetPlaybackFlags } from "@/lib/assets/playback-flags";
import { videoProxyCacheKey } from "@/lib/assets/transcoding";
import { loadConfig } from "@/lib/config";
import { getWorkerDb } from "@/lib/db";
import { assets, jobFailures, sequenceFrames } from "@/lib/db/schema";
import { publishJobEvent } from "@/lib/jobs/enqueue";
import { JOB_NAMES, type AssetJobData } from "@/lib/jobs/types";
import { getLogger } from "@/lib/logger";
import { getStorageAdapter } from "@/lib/storage";
import { ffmpegAvailable } from "../lib/ffmpeg";
import { withFfmpegLock } from "../lib/ffmpeg-mutex";
import { encodeHlsPackage, encodeMp4Proxy } from "../lib/hls-encode";
import { localMediaPath, localSequenceFramePath } from "../lib/media-path";
import { stitchSequenceMp4 } from "../lib/sequence-stitch";

const logger = getLogger().child({ worker: JOB_NAMES.WEB_TRANSCODING });

async function resolveSequenceFramePaths(
  userId: string,
  assetId: string,
): Promise<string[]> {
  const db = getWorkerDb();
  const frames = await db
    .select()
    .from(sequenceFrames)
    .where(eq(sequenceFrames.assetId, assetId))
    .orderBy(asc(sequenceFrames.frameIndex));

  const paths: string[] = [];
  for (const frame of frames) {
    const ext =
      path.extname(frame.filename).replace(/^\./, "").toLowerCase() || "jpg";
    const framePath = localSequenceFramePath(
      userId,
      assetId,
      frame.frameIndex,
      ext,
    );
    await fs.access(framePath);
    paths.push(framePath);
  }
  return paths;
}

export function createWebTranscodingWorker(connection: { url: string }) {
  const config = loadConfig();

  const worker = new Worker<AssetJobData>(
    JOB_NAMES.WEB_TRANSCODING,
    async (job) => {
      const { userId, assetId } = job.data;
      const db = getWorkerDb();
      const storage = getStorageAdapter();

      await publishJobEvent({
        userId,
        jobType: JOB_NAMES.WEB_TRANSCODING,
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

      if (asset.assetType !== "video" && asset.assetType !== "sequence") {
        await publishJobEvent({
          userId,
          jobType: JOB_NAMES.WEB_TRANSCODING,
          assetId,
          status: "complete",
          message: "Skipped — not a video or sequence asset",
          timestamp: new Date().toISOString(),
        });
        return { assetId, skipped: true };
      }

      if (
        asset.assetType === "sequence" &&
        asset.sequenceKind === "panorama"
      ) {
        await publishJobEvent({
          userId,
          jobType: JOB_NAMES.WEB_TRANSCODING,
          assetId,
          status: "complete",
          message: "Skipped — panorama uses stitch preview, not video proxy",
          timestamp: new Date().toISOString(),
        });
        return { assetId, skipped: true };
      }

      const proxyKey = videoProxyCacheKey(userId, assetId);
      const hlsPlaylistKey = videoHlsPlaylistKey(userId, assetId);
      const proxyExists = await storage.exists(proxyKey, { tier: "cache" });
      let hlsExists = await storage.exists(hlsPlaylistKey, { tier: "cache" });
      if (hlsExists) {
        const playlist = await storage.get(hlsPlaylistKey, { tier: "cache" });
        const text = playlist ? Buffer.from(playlist).toString("utf8") : "";
        // Rebuild non-ABR playlists and packages encoded before the 1080/1440 ladder.
        const stalePackage = !text.includes("EXT-X-DRONE-MEDIA-HLS:3");
        if (!text.includes("EXT-X-STREAM-INF") || stalePackage) {
          await storage.deletePrefix(videoHlsPrefix(userId, assetId), {
            tier: "cache",
          });
          // Proxy may still be fine at maxHeight; only force HLS rebuild.
          hlsExists = false;
          await setAssetPlaybackFlags(assetId, { hasHls: false });
        }
      }

      // LRF can satisfy progressive playback without a cache proxy MP4.
      const progressiveReady = proxyExists || asset.hasLrf;

      if (progressiveReady && hlsExists) {
        await setAssetPlaybackFlags(assetId, {
          hasProxy: true,
          hasHls: true,
        });
        await publishJobEvent({
          userId,
          jobType: JOB_NAMES.WEB_TRANSCODING,
          assetId,
          status: "complete",
          message: "Proxy and ABR HLS already exist",
          timestamp: new Date().toISOString(),
        });
        return { assetId, skipped: true };
      }

      if (!(await ffmpegAvailable())) {
        await publishJobEvent({
          userId,
          jobType: JOB_NAMES.WEB_TRANSCODING,
          assetId,
          status: "complete",
          message: "ffmpeg not available — serving original",
          timestamp: new Date().toISOString(),
        });
        logger.warn({ assetId }, "ffmpeg not installed; skipping web proxy");
        return { assetId, skipped: true };
      }

      const { madeProxy, madeHls } = await withFfmpegLock(async () => {
        const tempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), "dm-transcode-"),
        );
        let madeProxy = false;
        let madeHls = false;

        try {
          let inputPath: string;

          if (asset.assetType === "sequence") {
            const framePaths = await resolveSequenceFramePaths(userId, assetId);
            if (framePaths.length === 0) {
              throw new Error("Sequence has no frames on disk");
            }
            const stitchPath = path.join(tempDir, "sequence-source.mp4");
            await stitchSequenceMp4({
              framePaths,
              outputPath: stitchPath,
              quality: "proxy",
              fps: asset.sequenceFps ?? undefined,
            });
            inputPath = stitchPath;

            if (!proxyExists) {
              await storage.put(proxyKey, createReadStream(stitchPath), {
                tier: "cache",
                contentType: "video/mp4",
              });
              madeProxy = true;
            }
          } else {
            const mainPath = localMediaPath(userId, assetId, asset.mainFileExt);
            try {
              await fs.access(mainPath);
            } catch {
              throw new Error("Main media file not found on disk");
            }
            inputPath = mainPath;

            // Prefer drone LRF as progressive proxy (no duplicate cache encode).
            // HLS still uses the original so quality rungs stay distinct.
            if (!proxyExists && !asset.hasLrf) {
              const outputPath = path.join(tempDir, "proxy.mp4");
              await encodeMp4Proxy(mainPath, outputPath);
              await storage.put(proxyKey, createReadStream(outputPath), {
                tier: "cache",
                contentType: "video/mp4",
              });
              madeProxy = true;
            } else if (asset.hasLrf) {
              madeProxy = true;
            }
          }

          if (!hlsExists) {
            const hlsDir = path.join(tempDir, "hls");
            // Sequences: stitched proxy source. Videos: full original (not LRF).
            const hlsInput =
              asset.assetType === "sequence"
                ? path.join(tempDir, "sequence-source.mp4")
                : inputPath;
            const { files } = await encodeHlsPackage(hlsInput, hlsDir);
            for (const fileName of files) {
              const filePath = path.join(hlsDir, ...fileName.split("/"));
              const key = videoHlsSegmentKey(
                userId,
                assetId,
                ...fileName.split("/"),
              );
              const contentType = fileName.endsWith(".m3u8")
                ? "application/vnd.apple.mpegurl"
                : "video/mp2t";
              await storage.put(key, createReadStream(filePath), {
                tier: "cache",
                contentType,
              });
            }
            madeHls = true;
            logger.info(
              {
                assetId,
                segmentCount: files.length,
                prefix: videoHlsPrefix(userId, assetId),
              },
              "HLS package stored",
            );
          }
        } finally {
          await fs.rm(tempDir, { recursive: true, force: true });
        }

        return { madeProxy, madeHls };
      });

      await setAssetPlaybackFlags(assetId, {
        hasProxy: progressiveReady || madeProxy || asset.hasLrf,
        hasHls: hlsExists || madeHls,
      });

      await publishJobEvent({
        userId,
        jobType: JOB_NAMES.WEB_TRANSCODING,
        assetId,
        status: "complete",
        timestamp: new Date().toISOString(),
      });

      logger.info({ assetId, madeProxy, madeHls }, "Web transcoding complete");
      return { assetId, madeProxy, madeHls };
    },
    {
      connection,
      concurrency: config.jobs.concurrency.webTranscoding,
    },
  );

  worker.on("failed", async (job, error) => {
    if (!job) return;
    const db = getWorkerDb();
    await db.insert(jobFailures).values({
      jobType: JOB_NAMES.WEB_TRANSCODING,
      entityType: "asset",
      entityId: job.data.assetId,
      errorDetail: error.message,
      attemptCount: job.attemptsMade,
      payload: job.data as unknown as Record<string, unknown>,
    });
    await publishJobEvent({
      userId: job.data.userId,
      jobType: JOB_NAMES.WEB_TRANSCODING,
      assetId: job.data.assetId,
      status: "failed",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  });

  return worker;
}
