import path from "node:path";

import { Worker } from "bullmq";
import { asc, eq } from "drizzle-orm";
import exifr from "exifr";
import sharp from "sharp";

import { captureDateFromFilename } from "@/lib/assets/capture-extract";
import {
  adoptPhotoAssetAsDjiStitch,
  findPanoramaForCaptureIndex,
  panoramaHasDjiStitch,
} from "@/lib/assets/panorama-dji";
import {
  mergePhotoMetadata,
  mergeVideoMetadata,
  photoMetadataFromExif,
  videoMetadataFromProbe,
  withAutoPanoramaViewer,
  type MediaMetadata,
  type PhotoMediaMetadata,
} from "@/lib/assets/media-metadata";
import {
  parseLocationWkt,
  timezoneFromGps,
} from "@/lib/assets/timezone";
import { loadConfig } from "@/lib/config";
import { getWorkerDb } from "@/lib/db";
import { assets, jobFailures, sequenceFrames, uploadFiles } from "@/lib/db/schema";
import { assignAssetToFlight } from "@/lib/flights/queries";
import { publishJobEvent } from "@/lib/jobs/enqueue";
import {
  getPanoramaStitchQueue,
  getSrtFlightPathQueue,
  getWebTranscodingQueue,
} from "@/lib/jobs/queues";
import { JOB_NAMES, type AssetJobData } from "@/lib/jobs/types";
import { getLogger } from "@/lib/logger";
import { parseDjiStitchedPanoramaFilename } from "@/lib/upload/sequences";
import {
  capturedAtFromExifTool,
  gpsFromExifTool,
  isEquirectStitchTags,
  photoFieldsFromExifTool,
  readExifToolTags,
  type ExifToolTags,
} from "../lib/exiftool";
import { probeVideo } from "../lib/ffmpeg";
import { localMediaPath, localSequenceFramePath } from "../lib/media-path";
import { readMediaFile, readSequenceFrameByKey } from "../lib/storage";

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

function applyExifToolPhoto(
  tags: ExifToolTags,
  base: MediaMetadata | null,
): PhotoMediaMetadata {
  const photoBase =
    base?.kind === "photo" ? base : emptyPhotoMeta();
  // Preserve an existing user viewer choice across merges.
  const priorViewer =
    photoBase.panoramaViewer ??
    (base?.kind === "photo" ? base.panoramaViewer : null) ??
    null;
  const toolPhoto = photoFieldsFromExifTool(tags);
  let merged = mergePhotoMetadata(photoBase, toolPhoto);
  merged.panoramaViewer = priorViewer;
  if (isEquirectStitchTags(tags)) {
    const ratio =
      toolPhoto.width != null && toolPhoto.height != null && toolPhoto.height > 0
        ? toolPhoto.width / toolPhoto.height
        : null;
    const sphere = ratio != null ? ratio >= 1.9 && ratio <= 2.1 : true;
    merged.panoramaSphere = sphere;
    if (toolPhoto.width != null) {
      merged.panoramaWidth = toolPhoto.width;
      merged.width = toolPhoto.width;
    }
    if (toolPhoto.height != null) {
      merged.panoramaHeight = toolPhoto.height;
      merged.height = toolPhoto.height;
    }
    merged = withAutoPanoramaViewer(merged, sphere ? "360" : "180");
  }
  return merged;
}

const logger = getLogger().child({ worker: JOB_NAMES.METADATA });

async function extractPhotoExif(media: Buffer): Promise<{
  locationWkt: string | null;
  capturedAt: Date | null;
  mediaMetadata: MediaMetadata | null;
}> {
  let locationWkt: string | null = null;
  let capturedAt: Date | null = null;
  let mediaMetadata: MediaMetadata | null = null;

  try {
    const gps = await exifr.gps(media);
    if (
      typeof gps?.latitude === "number" &&
      typeof gps?.longitude === "number" &&
      Number.isFinite(gps.latitude) &&
      Number.isFinite(gps.longitude)
    ) {
      locationWkt = `SRID=4326;POINT(${gps.longitude} ${gps.latitude})`;
    }

    const exif = (await exifr.parse(media, {
      gps: true,
      exif: true,
      pick: [
        "DateTimeOriginal",
        "CreateDate",
        "OffsetTimeOriginal",
        "Make",
        "Model",
        "LensMake",
        "LensModel",
        "Software",
        "FNumber",
        "ApertureValue",
        "ExposureTime",
        "ISO",
        "ISOSpeedRatings",
        "PhotographicSensitivity",
        "ExposureBiasValue",
        "FocalLength",
        "ExifImageWidth",
        "ExifImageHeight",
        "ImageWidth",
        "ImageHeight",
        "PixelXDimension",
        "PixelYDimension",
      ],
    } as Parameters<typeof exifr.parse>[1])) as
      | Record<string, unknown>
      | undefined;

    const exifDate =
      (exif?.DateTimeOriginal as Date | undefined) ??
      (exif?.CreateDate as Date | undefined);
    if (exifDate instanceof Date && !Number.isNaN(exifDate.getTime())) {
      capturedAt = exifDate;
    }

    mediaMetadata = await enrichPhotoDimensions(
      media,
      photoMetadataFromExif(exif),
    );
  } catch {
    // caller may log
  }

  return { locationWkt, capturedAt, mediaMetadata };
}

function isUploadFallbackDate(
  candidate: Date | null | undefined,
  createdAt: Date,
): boolean {
  if (!candidate) return true;
  return Math.abs(candidate.getTime() - createdAt.getTime()) < 2_000;
}

async function enrichPhotoDimensions(
  source: Buffer | string,
  metadata: MediaMetadata,
): Promise<MediaMetadata> {
  if (metadata.kind !== "photo") return metadata;
  if (metadata.width != null && metadata.height != null) return metadata;
  try {
    const info = await sharp(source, { limitInputPixels: false }).metadata();
    return {
      ...metadata,
      width: metadata.width ?? info.width ?? null,
      height: metadata.height ?? info.height ?? null,
    };
  } catch {
    return metadata;
  }
}

/** Avoid loading huge DJI stitches into Node heap just to read EXIF. */
const EXIFR_MAX_BYTES = 20 * 1024 * 1024;

export function createMetadataWorker(connection: { url: string }) {
  const config = loadConfig();

  const worker = new Worker<AssetJobData>(
    JOB_NAMES.METADATA,
    async (job) => {
      const { userId, assetId } = job.data;
      const db = getWorkerDb();

      await publishJobEvent({
        userId,
        jobType: JOB_NAMES.METADATA,
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

      const updates: Partial<typeof assets.$inferInsert> = {
        updatedAt: new Date(),
      };

      let capturedAt: Date | null = null;
      let capturedTimezone: string | null = asset.capturedTimezone;
      let locationWkt: string | null = null;
      let mediaMetadata: MediaMetadata | null = null;

      const [uploadFile] = await db
        .select({
          clientModifiedAt: uploadFiles.clientModifiedAt,
          displayName: uploadFiles.displayName,
        })
        .from(uploadFiles)
        .where(eq(uploadFiles.assetId, assetId))
        .limit(1);

      const inputPath = localMediaPath(userId, assetId, asset.mainFileExt);

      if (asset.assetType === "photo") {
        let toolTags: ExifToolTags | null = null;
        // Prefer ExifTool on the file path — handles GPano + large DJI stitches
        // without buffering the whole JPEG into the Node heap.
        try {
          toolTags = await readExifToolTags(inputPath);
          if (toolTags) {
            const toolGps = gpsFromExifTool(toolTags);
            if (toolGps) {
              locationWkt = `SRID=4326;POINT(${toolGps.longitude} ${toolGps.latitude})`;
            }
            mediaMetadata = applyExifToolPhoto(toolTags, mediaMetadata);
            capturedAt = capturedAtFromExifTool(toolTags);
            mediaMetadata = await enrichPhotoDimensions(
              inputPath,
              mediaMetadata,
            );
          }
        } catch (error) {
          logger.warn({ assetId, err: error }, "ExifTool enrichment failed");
        }

        const fileSize = asset.fileSizeBytes ?? 0;
        if (
          (!mediaMetadata || !locationWkt || !capturedAt) &&
          fileSize > 0 &&
          fileSize <= EXIFR_MAX_BYTES
        ) {
          const media = await readMediaFile(
            userId,
            assetId,
            asset.mainFileExt,
          );
          if (media) {
            try {
              const extracted = await extractPhotoExif(media);
              locationWkt = locationWkt ?? extracted.locationWkt;
              capturedAt = capturedAt ?? extracted.capturedAt;
              mediaMetadata = mediaMetadata
                ? mergePhotoMetadata(
                    mediaMetadata.kind === "photo"
                      ? mediaMetadata
                      : emptyPhotoMeta(),
                    extracted.mediaMetadata?.kind === "photo"
                      ? extracted.mediaMetadata
                      : null,
                  )
                : extracted.mediaMetadata;
            } catch (error) {
              logger.warn(
                { assetId, err: error },
                "EXIF parse failed; falling back",
              );
            }
          }
        } else if (!mediaMetadata && fileSize > EXIFR_MAX_BYTES) {
          logger.info(
            { assetId, fileSize },
            "Skipping in-process EXIF for large photo; ExifTool path used",
          );
        }

        // Auto-link DJI equirect stitches (by filename and/or GPano tags)
        // onto an existing PANORAMA/100_XXXX asset uploaded earlier.
        const captureIndex =
          parseDjiStitchedPanoramaFilename(asset.displayName)?.captureIndex ??
          parseDjiStitchedPanoramaFilename(
            uploadFile?.displayName ?? "",
          )?.captureIndex ??
          null;
        const looksLikeStitch =
          Boolean(captureIndex) || isEquirectStitchTags(toolTags);

        if (looksLikeStitch && captureIndex) {
          const panorama = await findPanoramaForCaptureIndex(
            userId,
            captureIndex,
          );
          if (
            panorama &&
            !(await panoramaHasDjiStitch(userId, panorama.id))
          ) {
            // Persist photo meta first so adopt can copy camera/GPS onto the pano.
            if (mediaMetadata || locationWkt || capturedAt) {
              await db
                .update(assets)
                .set({
                  mediaMetadata: mediaMetadata ?? asset.mediaMetadata,
                  locationOriginal:
                    locationWkt ?? asset.locationOriginal ?? undefined,
                  capturedAtOriginal:
                    capturedAt ?? asset.capturedAtOriginal ?? undefined,
                  updatedAt: new Date(),
                })
                .where(eq(assets.id, assetId));
            }

            const adopted = await adoptPhotoAssetAsDjiStitch({
              userId,
              panoramaId: panorama.id,
              photoId: assetId,
              restitch: true,
            });
            if (adopted) {
              await publishJobEvent({
                userId,
                jobType: JOB_NAMES.METADATA,
                assetId,
                status: "complete",
                message: `Linked stitch to ${panorama.displayName}`,
                timestamp: new Date().toISOString(),
              });
              logger.info(
                { assetId, panoramaId: panorama.id, captureIndex },
                "Adopted equirect photo as DJI panorama stitch",
              );
              return { assetId, adoptedInto: panorama.id };
            }
          }
        }
      } else if (asset.assetType === "sequence") {
        const frames = await db
          .select()
          .from(sequenceFrames)
          .where(eq(sequenceFrames.assetId, assetId))
          .orderBy(asc(sequenceFrames.frameIndex));

        let earliest: Date | null = null;
        let representativeMeta: MediaMetadata | null = null;
        let djiStitchMeta: PhotoMediaMetadata | null = null;

        // Official DJI stitch carries the authoritative camera / GPS / date.
        if (asset.sequenceKind === "panorama") {
          const djiPath = localMediaPath(userId, assetId, "dji-pano.jpg");
          try {
            const djiTags = await readExifToolTags(djiPath);
            if (djiTags) {
              const toolGps = gpsFromExifTool(djiTags);
              if (toolGps) {
                locationWkt = `SRID=4326;POINT(${toolGps.longitude} ${toolGps.latitude})`;
              }
              djiStitchMeta = applyExifToolPhoto(djiTags, null);
              capturedAt = capturedAtFromExifTool(djiTags);
              earliest = capturedAt;
            }
          } catch (error) {
            logger.warn(
              { assetId, err: error },
              "DJI stitch ExifTool enrichment failed",
            );
          }
        }

        for (const frame of frames) {
          const media = await readSequenceFrameByKey(frame.storageKey);
          if (!media) continue;

          let frameCaptured: Date | null = null;
          let frameLocation: string | null = null;

          try {
            const extracted = await extractPhotoExif(media);
            frameCaptured = extracted.capturedAt;
            frameLocation = extracted.locationWkt;
            if (frame.frameIndex === 0 || !representativeMeta) {
              representativeMeta = extracted.mediaMetadata;
            }
            if (extracted.locationWkt && !locationWkt) {
              locationWkt = extracted.locationWkt;
            }
            if (
              extracted.capturedAt &&
              (!earliest || extracted.capturedAt < earliest)
            ) {
              earliest = extracted.capturedAt;
            }
          } catch (error) {
            logger.warn(
              { assetId, frameIndex: frame.frameIndex, err: error },
              "Sequence frame EXIF failed",
            );
          }

          if (frame.frameIndex === 0) {
            const ext =
              path.extname(frame.filename).replace(/^\./, "").toLowerCase() ||
              "jpg";
            const framePath = localSequenceFramePath(
              userId,
              assetId,
              frame.frameIndex,
              ext,
            );
            try {
              const toolTags = await readExifToolTags(framePath);
              if (toolTags) {
                const toolGps = gpsFromExifTool(toolTags);
                if (toolGps && !locationWkt) {
                  locationWkt = `SRID=4326;POINT(${toolGps.longitude} ${toolGps.latitude})`;
                  frameLocation = locationWkt;
                }
                representativeMeta = applyExifToolPhoto(
                  toolTags,
                  representativeMeta,
                );
              }
            } catch (error) {
              logger.warn(
                { assetId, err: error },
                "Sequence ExifTool enrichment failed",
              );
            }
          }

          const frameUpdates: Partial<typeof sequenceFrames.$inferInsert> = {};
          if (frameCaptured) frameUpdates.capturedAt = frameCaptured;
          if (frameLocation) frameUpdates.location = frameLocation;
          if (Object.keys(frameUpdates).length > 0) {
            await db
              .update(sequenceFrames)
              .set(frameUpdates)
              .where(eq(sequenceFrames.id, frame.id));
          }
        }

        // Prefer stitch EXIF for camera stats; keep any prior panorama canvas size.
        if (djiStitchMeta) {
          const prior =
            asset.mediaMetadata?.kind === "photo" ? asset.mediaMetadata : null;
          const fromTiles =
            representativeMeta?.kind === "photo" ? representativeMeta : null;
          mediaMetadata = mergePhotoMetadata(
            djiStitchMeta,
            mergePhotoMetadata(fromTiles ?? emptyPhotoMeta(), prior),
          );
          mediaMetadata.panoramaWidth =
            prior?.panoramaWidth ??
            djiStitchMeta.panoramaWidth ??
            mediaMetadata.panoramaWidth;
          mediaMetadata.panoramaHeight =
            prior?.panoramaHeight ??
            djiStitchMeta.panoramaHeight ??
            mediaMetadata.panoramaHeight;
          mediaMetadata.panoramaSphere =
            prior?.panoramaSphere ??
            djiStitchMeta.panoramaSphere ??
            mediaMetadata.panoramaSphere;
          // Never overwrite an explicit user viewer choice.
          mediaMetadata.panoramaViewer =
            prior?.panoramaViewer ??
            djiStitchMeta.panoramaViewer ??
            mediaMetadata.panoramaViewer;
        } else {
          capturedAt = earliest;
          mediaMetadata = representativeMeta;
        }
        if (!capturedAt) capturedAt = earliest;
      } else {
        const probe = await probeVideo(inputPath);
        if (probe) {
          const tags = probe.format?.tags ?? {};
          const raw =
            tags.creation_time ?? tags["com.apple.quicktime.creationdate"];
          if (raw) {
            const date = new Date(raw);
            if (!Number.isNaN(date.getTime())) capturedAt = date;
          }
          const probed = videoMetadataFromProbe(probe);
          mediaMetadata = mergeVideoMetadata(
            probed,
            asset.mediaMetadata?.kind === "video"
              ? asset.mediaMetadata
              : null,
          );
        }
      }

      if (!capturedAt) {
        capturedAt = captureDateFromFilename(
          uploadFile?.displayName ?? asset.displayName,
        );
      }

      if (!capturedAt && uploadFile?.clientModifiedAt) {
        capturedAt = uploadFile.clientModifiedAt;
      }

      // Only overwrite when we have a better source than "upload time"
      if (
        capturedAt &&
        (isUploadFallbackDate(asset.capturedAtOriginal, asset.createdAt) ||
          !asset.capturedAtOriginal)
      ) {
        updates.capturedAtOriginal = capturedAt;
      } else if (!asset.capturedAtOriginal) {
        updates.capturedAtOriginal = asset.createdAt;
      }

      if (!asset.capturedTimezone) {
        const point =
          parseLocationWkt(locationWkt) ??
          parseLocationWkt(
            typeof asset.locationOriginal === "string"
              ? asset.locationOriginal
              : null,
          );
        const fromGps = point
          ? timezoneFromGps(point.lat, point.lng)
          : null;
        updates.capturedTimezone = fromGps ?? capturedTimezone ?? "UTC";
      }

      if (locationWkt && !asset.locationOriginal) {
        updates.locationOriginal = locationWkt;
      }

      if (mediaMetadata) {
        updates.mediaMetadata = mediaMetadata;
      }

      if (Object.keys(updates).length > 1) {
        await db.update(assets).set(updates).where(eq(assets.id, assetId));
      }

      // Photos / panos join existing video flights by time/GPS; never create alone.
      if (
        asset.assetType === "photo" ||
        (asset.assetType === "sequence" && asset.sequenceKind === "panorama")
      ) {
        await assignAssetToFlight(db, assetId, { createIfMissing: false });
      }

      if (asset.hasSrt) {
        await getSrtFlightPathQueue().add(
          "srtFlightPath",
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
          jobType: JOB_NAMES.SRT_FLIGHT_PATH,
          assetId,
          status: "queued",
          timestamp: new Date().toISOString(),
        });
      }

      if (asset.assetType === "sequence" && asset.sequenceKind === "panorama") {
        await getPanoramaStitchQueue().add(
          "panoramaStitch",
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
          jobType: JOB_NAMES.PANORAMA_STITCH,
          assetId,
          status: "queued",
          timestamp: new Date().toISOString(),
        });
      } else if (
        asset.assetType === "video" ||
        asset.assetType === "sequence"
      ) {
        await getWebTranscodingQueue().add(
          "webTranscoding",
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
          jobType: JOB_NAMES.WEB_TRANSCODING,
          assetId,
          status: "queued",
          timestamp: new Date().toISOString(),
        });
      }

      await publishJobEvent({
        userId,
        jobType: JOB_NAMES.METADATA,
        assetId,
        status: "complete",
        timestamp: new Date().toISOString(),
      });

      logger.info(
        {
          assetId,
          capturedAt: (
            updates.capturedAtOriginal as Date | undefined
          )?.toISOString(),
          hasLocation: Boolean(locationWkt || asset.locationOriginal),
          hasMediaMetadata: Boolean(mediaMetadata),
        },
        "Metadata worker complete",
      );
      return { assetId };
    },
    {
      connection,
      concurrency: config.jobs.concurrency.metadata,
    },
  );

  worker.on("failed", async (job, error) => {
    if (!job) return;
    const db = getWorkerDb();
    await db.insert(jobFailures).values({
      jobType: JOB_NAMES.METADATA,
      entityType: "asset",
      entityId: job.data.assetId,
      errorDetail: error.message,
      attemptCount: job.attemptsMade,
      payload: job.data as unknown as Record<string, unknown>,
    });
    await publishJobEvent({
      userId: job.data.userId,
      jobType: JOB_NAMES.METADATA,
      assetId: job.data.assetId,
      status: "failed",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  });

  return worker;
}
