import { Worker } from "bullmq";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { asc, eq } from "drizzle-orm";

import {
  mergePhotoMetadata,
  withAutoPanoramaViewer,
  type PhotoMediaMetadata,
} from "@/lib/assets/media-metadata";
import { timezoneFromGps } from "@/lib/assets/timezone";
import { thumbnailCacheKey } from "@/lib/assets/thumbnails";
import {
  panoramaDjiStitchedMediaKey,
  panoramaEquirectCacheKey,
  panoramaEquirectViewCacheKey,
} from "@/lib/assets/transcoding";
import { loadConfig } from "@/lib/config";
import { getWorkerDb } from "@/lib/db";
import { assets, jobFailures, sequenceFrames } from "@/lib/db/schema";
import { publishJobEvent } from "@/lib/jobs/enqueue";
import { JOB_NAMES, type AssetJobData } from "@/lib/jobs/types";
import { getLogger } from "@/lib/logger";
import { getStorageAdapter } from "@/lib/storage";
import sharp from "sharp";
import {
  capturedAtFromExifTool,
  gpsFromExifTool,
  isEquirectStitchTags,
  photoFieldsFromExifTool,
  readExifToolTags,
} from "../lib/exiftool";
import { localMediaPath, localSequenceFramePath } from "../lib/media-path";
import { stitchPanoramaEquirect } from "../lib/panorama-stitch";

const logger = getLogger().child({ worker: JOB_NAMES.PANORAMA_STITCH });

function emptyPhotoMeta(): PhotoMediaMetadata {
  return {
    kind: "photo",
    width: null,
    height: null,
    cameraMake: null,
    cameraModel: null,
    lensMake: null,
    lensModel: null,
    software: null,
    fNumber: null,
    exposureTimeSeconds: null,
    iso: null,
    exposureBias: null,
    focalLengthMm: null,
    altitudeMeters: null,
    panoramaWidth: null,
    panoramaHeight: null,
    panoramaSphere: null,
    panoramaViewer: null,
  };
}

function isSphereAspect(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  const ratio = width / height;
  return ratio >= 1.9 && ratio <= 2.1;
}

export function createPanoramaStitchWorker(connection: { url: string }) {
  const config = loadConfig();

  const worker = new Worker<AssetJobData>(
    JOB_NAMES.PANORAMA_STITCH,
    async (job) => {
      const { userId, assetId } = job.data;
      const db = getWorkerDb();
      const storage = getStorageAdapter();

      await publishJobEvent({
        userId,
        jobType: JOB_NAMES.PANORAMA_STITCH,
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

      if (
        asset.assetType !== "sequence" ||
        asset.sequenceKind !== "panorama"
      ) {
        await publishJobEvent({
          userId,
          jobType: JOB_NAMES.PANORAMA_STITCH,
          assetId,
          status: "complete",
          message: "Skipped — not a panorama sequence",
          timestamp: new Date().toISOString(),
        });
        return { assetId, skipped: true };
      }

      const outKey = panoramaEquirectCacheKey(userId, assetId);
      if (await storage.exists(outKey, { tier: "cache" })) {
        await publishJobEvent({
          userId,
          jobType: JOB_NAMES.PANORAMA_STITCH,
          assetId,
          status: "complete",
          message: "Panorama preview already exists",
          timestamp: new Date().toISOString(),
        });
        return { assetId, skipped: true };
      }

      async function persistEquirect(
        data: Buffer,
        meta: { width: number; height: number; sphere: boolean },
        source: "dji" | "tiles",
        djiLocalPath?: string,
      ) {
        await storage.put(outKey, data, {
          tier: "cache",
          contentType: "image/jpeg",
        });

        try {
          const viewData = await sharp(data, { limitInputPixels: false })
            .rotate()
            .resize(16384, 8192, {
              fit: "inside",
              withoutEnlargement: true,
            })
            .jpeg({ quality: 92, mozjpeg: true })
            .toBuffer();
          await storage.put(
            panoramaEquirectViewCacheKey(userId, assetId),
            viewData,
            { tier: "cache", contentType: "image/jpeg" },
          );
        } catch (error) {
          logger.warn({ assetId, err: error }, "Panorama view resize failed");
        }

        const existing =
          asset.mediaMetadata?.kind === "photo" ? asset.mediaMetadata : null;
        const priorViewer = existing?.panoramaViewer ?? null;
        let next = mergePhotoMetadata(existing ?? emptyPhotoMeta(), {
          panoramaWidth: meta.width,
          panoramaHeight: meta.height,
          panoramaSphere: meta.sphere,
        });
        next.panoramaWidth = meta.width;
        next.panoramaHeight = meta.height;
        next.panoramaSphere = meta.sphere;
        next.panoramaViewer = priorViewer;
        next = withAutoPanoramaViewer(next, meta.sphere ? "360" : "180");

        const assetUpdates: Partial<typeof assets.$inferInsert> = {
          mediaMetadata: next,
          updatedAt: new Date(),
        };

        // Pull camera / GPS / capture time from the official stitch JPEG.
        if (source === "dji" && djiLocalPath) {
          try {
            const tags = await readExifToolTags(djiLocalPath);
            if (tags) {
              const fields = photoFieldsFromExifTool(tags);
              const sphere = meta.sphere || isEquirectStitchTags(tags);
              // Stitch EXIF wins for camera stats; keep canvas size above.
              next = mergePhotoMetadata(
                {
                  ...emptyPhotoMeta(),
                  ...fields,
                  kind: "photo",
                  panoramaWidth: meta.width,
                  panoramaHeight: meta.height,
                  panoramaSphere: sphere,
                  panoramaViewer: priorViewer,
                },
                existing,
              );
              next.panoramaWidth = meta.width;
              next.panoramaHeight = meta.height;
              next.panoramaSphere = sphere;
              next.panoramaViewer = priorViewer;
              next = withAutoPanoramaViewer(next, sphere ? "360" : "180");
              assetUpdates.mediaMetadata = next;

              const gps = gpsFromExifTool(tags);
              if (gps) {
                assetUpdates.locationOriginal = `SRID=4326;POINT(${gps.longitude} ${gps.latitude})`;
                assetUpdates.capturedTimezone =
                  timezoneFromGps(gps.latitude, gps.longitude) ??
                  asset.capturedTimezone ??
                  "UTC";
              }

              const captured = capturedAtFromExifTool(tags);
              if (captured) {
                assetUpdates.capturedAtOriginal = captured;
              }
            }
          } catch (error) {
            logger.warn(
              { assetId, err: error },
              "Failed to read DJI stitch EXIF",
            );
          }
        }

        await db
          .update(assets)
          .set(assetUpdates)
          .where(eq(assets.id, assetId));

        try {
          const webp = await sharp(data, { limitInputPixels: false })
            .rotate()
            .resize(
              config.images.thumbnailMaxEdge,
              config.images.thumbnailMaxEdge,
              { fit: "inside", withoutEnlargement: true },
            )
            .webp({ quality: config.images.thumbnailQuality })
            .toBuffer();
          await storage.put(thumbnailCacheKey(userId, assetId), webp, {
            tier: "cache",
            contentType: "image/webp",
          });
        } catch (error) {
          logger.warn({ assetId, err: error }, "Panorama thumb refresh failed");
        }

        await publishJobEvent({
          userId,
          jobType: JOB_NAMES.PANORAMA_STITCH,
          assetId,
          status: "complete",
          message:
            source === "dji"
              ? "Using DJI stitched panorama"
              : undefined,
          timestamp: new Date().toISOString(),
        });

        logger.info(
          {
            assetId,
            bytes: data.byteLength,
            meta,
            source,
          },
          "Panorama equirect stored",
        );
      }

      // Prefer the official DJI Fly / aircraft stitch when uploaded with the tiles.
      const djiKey = panoramaDjiStitchedMediaKey(userId, assetId);
      const djiLocal = localMediaPath(userId, assetId, "dji-pano.jpg");
      let djiAvailable = false;
      try {
        await fs.access(djiLocal);
        djiAvailable = true;
      } catch {
        djiAvailable = await storage.exists(djiKey, { tier: "media" });
      }

      if (djiAvailable) {
        let data: Buffer;
        let exifPath = djiLocal;
        let tempExif: string | null = null;
        try {
          data = await fs.readFile(djiLocal);
        } catch {
          const remote = await storage.get(djiKey, { tier: "media" });
          if (!remote) {
            throw new Error("DJI stitched panorama missing from storage");
          }
          data = Buffer.from(remote);
          tempExif = path.join(
            os.tmpdir(),
            `dm-dji-exif-${assetId}.jpg`,
          );
          await fs.writeFile(tempExif, data);
          exifPath = tempExif;
        }
        try {
          const image = sharp(data, { limitInputPixels: false });
          const info = await image.metadata();
          const width = info.width ?? 0;
          const height = info.height ?? 0;
          await persistEquirect(
            data,
            {
              width,
              height,
              sphere: isSphereAspect(width, height),
            },
            "dji",
            exifPath,
          );
          return { assetId, bytes: data.byteLength, source: "dji" };
        } finally {
          if (tempExif) {
            await fs.unlink(tempExif).catch(() => undefined);
          }
        }
      }

      const frames = await db
        .select()
        .from(sequenceFrames)
        .where(eq(sequenceFrames.assetId, assetId))
        .orderBy(asc(sequenceFrames.frameIndex));

      const framePaths: string[] = [];
      for (const frame of frames) {
        const ext =
          path.extname(frame.filename).replace(/^\./, "").toLowerCase() ||
          "jpg";
        const local = localSequenceFramePath(
          userId,
          assetId,
          frame.frameIndex,
          ext,
        );
        try {
          await fs.access(local);
          framePaths.push(local);
        } catch {
          logger.warn(
            { assetId, frameIndex: frame.frameIndex, local },
            "Missing panorama tile on disk",
          );
        }
      }

      if (framePaths.length < 2) {
        throw new Error("Panorama has fewer than 2 tiles on disk");
      }

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dm-pano-"));
      const outPath = path.join(tempDir, "equirect.jpg");

      try {
        const result = await stitchPanoramaEquirect({
          framePaths,
          outputPath: outPath,
        });
        if (!result.ok) {
          throw new Error(result.message);
        }

        const data = await fs.readFile(outPath);
        const width = result.meta?.width ?? 0;
        const height = result.meta?.height ?? 0;
        await persistEquirect(
          data,
          {
            width,
            height,
            sphere: result.meta?.sphere ?? isSphereAspect(width, height),
          },
          "tiles",
        );
        return { assetId, bytes: data.byteLength, source: "tiles" };
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
    {
      connection,
      concurrency: config.jobs.concurrency.panoramaStitch ?? 1,
    },
  );

  worker.on("failed", async (job, error) => {
    if (!job) return;
    const db = getWorkerDb();
    await db.insert(jobFailures).values({
      jobType: JOB_NAMES.PANORAMA_STITCH,
      entityType: "asset",
      entityId: job.data.assetId,
      errorDetail: error.message,
      attemptCount: job.attemptsMade,
      payload: job.data as unknown as Record<string, unknown>,
    });
    await publishJobEvent({
      userId: job.data.userId,
      jobType: JOB_NAMES.PANORAMA_STITCH,
      assetId: job.data.assetId,
      status: "failed",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  });

  return worker;
}
