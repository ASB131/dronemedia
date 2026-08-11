import { Worker } from "bullmq";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";

import {
  mergePhotoMetadata,
  withAutoPanoramaViewer,
  type PhotoMediaMetadata,
} from "@/lib/assets/media-metadata";
import { timezoneFromGps } from "@/lib/assets/timezone";
import { thumbnailCacheKey } from "@/lib/assets/thumbnails";
import {
  PANORAMA_WEB_JPEG_QUALITY,
  PANORAMA_WEB_MAX_EDGE,
  panoramaDjiStitchedMediaKey,
  panoramaEquirectWebCacheKey,
} from "@/lib/assets/transcoding";
import { loadConfig } from "@/lib/config";
import { getWorkerDb } from "@/lib/db";
import { assets, jobFailures } from "@/lib/db/schema";
import { publishJobEvent } from "@/lib/jobs/enqueue";
import { JOB_NAMES, type AssetJobData } from "@/lib/jobs/types";
import { getLogger } from "@/lib/logger";
import { getStorageAdapter } from "@/lib/storage";
import {
  capturedAtFromExifTool,
  gpsFromExifTool,
  isEquirectStitchTags,
  photoFieldsFromExifTool,
  poseHeadingDegreesFromExifTool,
  readExifToolTags,
} from "../lib/exiftool";
import { localMediaPath } from "../lib/media-path";

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
    panoramaPoseHeadingDegrees: null,
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

      const webKey = panoramaEquirectWebCacheKey(userId, assetId);
      if (await storage.exists(webKey, { tier: "cache" })) {
        await publishJobEvent({
          userId,
          jobType: JOB_NAMES.PANORAMA_STITCH,
          assetId,
          status: "complete",
          message: "Panorama web preview already exists",
          timestamp: new Date().toISOString(),
        });
        return { assetId, skipped: true };
      }

      const djiKey = panoramaDjiStitchedMediaKey(userId, assetId);
      const djiLocal = localMediaPath(userId, assetId, "dji-pano.jpg");
      let djiAvailable = false;
      try {
        await fs.access(djiLocal);
        djiAvailable = true;
      } catch {
        djiAvailable = await storage.exists(djiKey, { tier: "media" });
      }

      if (!djiAvailable) {
        await publishJobEvent({
          userId,
          jobType: JOB_NAMES.PANORAMA_STITCH,
          assetId,
          status: "complete",
          message:
            "No panorama image — tiles only (individual tile viewing available)",
          timestamp: new Date().toISOString(),
        });
        return { assetId, skipped: true, reason: "no-pano-image" };
      }

      let data: Buffer;
      let exifPath = djiLocal;
      let tempExif: string | null = null;
      try {
        data = await fs.readFile(djiLocal);
      } catch {
        const remote = await storage.get(djiKey, { tier: "media" });
        if (!remote) {
          throw new Error("Panorama image missing from storage");
        }
        data = Buffer.from(remote);
        tempExif = path.join(os.tmpdir(), `dm-dji-exif-${assetId}.jpg`);
        await fs.writeFile(tempExif, data);
        exifPath = tempExif;
      }

      try {
        const image = sharp(data, { limitInputPixels: false });
        const info = await image.metadata();
        const width = info.width ?? 0;
        const height = info.height ?? 0;
        const sphere = isSphereAspect(width, height);

        const webData = await sharp(data, { limitInputPixels: false })
          .rotate()
          .resize(PANORAMA_WEB_MAX_EDGE, PANORAMA_WEB_MAX_EDGE, {
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: PANORAMA_WEB_JPEG_QUALITY, mozjpeg: true })
          .toBuffer();
        await storage.put(webKey, webData, {
          tier: "cache",
          contentType: "image/jpeg",
        });

        const existing =
          asset.mediaMetadata?.kind === "photo" ? asset.mediaMetadata : null;
        const priorViewer = existing?.panoramaViewer ?? null;
        let next = mergePhotoMetadata(existing ?? emptyPhotoMeta(), {
          panoramaWidth: width,
          panoramaHeight: height,
          panoramaSphere: sphere,
        });
        next.panoramaWidth = width;
        next.panoramaHeight = height;
        next.panoramaSphere = sphere;
        next.panoramaViewer = priorViewer;
        next = withAutoPanoramaViewer(next, sphere ? "360" : "180");

        const assetUpdates: Partial<typeof assets.$inferInsert> = {
          mediaMetadata: next,
          updatedAt: new Date(),
        };

        try {
          const tags = await readExifToolTags(exifPath);
          if (tags) {
            const fields = photoFieldsFromExifTool(tags);
            const sphereFromTags = sphere || isEquirectStitchTags(tags);
            next = mergePhotoMetadata(
              {
                ...emptyPhotoMeta(),
                ...fields,
                kind: "photo",
                panoramaWidth: width,
                panoramaHeight: height,
                panoramaSphere: sphereFromTags,
                panoramaViewer: priorViewer,
              },
              existing,
            );
            next.panoramaWidth = width;
            next.panoramaHeight = height;
            next.panoramaSphere = sphereFromTags;
            next.panoramaViewer = priorViewer;
            const heading = poseHeadingDegreesFromExifTool(tags);
            if (heading != null) {
              next.panoramaPoseHeadingDegrees = heading;
            } else if (existing?.panoramaPoseHeadingDegrees != null) {
              next.panoramaPoseHeadingDegrees =
                existing.panoramaPoseHeadingDegrees;
            }
            next = withAutoPanoramaViewer(
              next,
              sphereFromTags ? "360" : "180",
            );
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
            "Failed to read panorama image EXIF",
          );
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
          message: "Panorama web preview ready",
          timestamp: new Date().toISOString(),
        });

        logger.info(
          {
            assetId,
            bytes: data.byteLength,
            webBytes: webData.byteLength,
            width,
            height,
          },
          "Panorama web preview stored",
        );

        return { assetId, bytes: data.byteLength, source: "dji" };
      } finally {
        if (tempExif) {
          await fs.unlink(tempExif).catch(() => undefined);
        }
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
