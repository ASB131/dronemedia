import { Worker } from "bullmq";
import { and, eq, isNull } from "drizzle-orm";

import {
  hasSrtCameraFields,
  mergeVideoMetadata,
  type VideoMediaMetadata,
} from "@/lib/assets/media-metadata";
import { loadConfig } from "@/lib/config";
import { getWorkerDb } from "@/lib/db";
import {
  assets,
  flightTelemetry,
  jobFailures,
  telemetryPoints,
  videoChapters,
} from "@/lib/db/schema";
import {
  assignAssetToFlight,
  attachNearbyPhotosToFlight,
} from "@/lib/flights/queries";
import { publishJobEvent } from "@/lib/jobs/enqueue";
import { JOB_NAMES, type AssetJobData } from "@/lib/jobs/types";
import { getLogger } from "@/lib/logger";
import {
  parseSrt,
  pickRepresentativeSrtCamera,
  type ParsedSrtPoint,
} from "../lib/srt-parse";
import { readMediaFile } from "../lib/storage";

const logger = getLogger().child({ worker: JOB_NAMES.SRT_FLIGHT_PATH });

function haversineMeters(
  a: Pick<ParsedSrtPoint, "lat" | "lng">,
  b: Pick<ParsedSrtPoint, "lat" | "lng">,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function buildLineString(points: ParsedSrtPoint[]): string {
  const coords = points.map((point) => `${point.lng} ${point.lat}`).join(", ");
  return `SRID=4326;LINESTRING(${coords})`;
}

async function markParseFailed(assetId: string) {
  const db = getWorkerDb();
  await db
    .insert(flightTelemetry)
    .values({
      assetId,
      parseStatus: "failed",
    })
    .onConflictDoUpdate({
      target: flightTelemetry.assetId,
      set: { parseStatus: "failed", updatedAt: new Date() },
    });
}

export function createSrtFlightPathWorker(connection: { url: string }) {
  const config = loadConfig();

  const worker = new Worker<AssetJobData>(
    JOB_NAMES.SRT_FLIGHT_PATH,
    async (job) => {
      const { userId, assetId } = job.data;
      const db = getWorkerDb();

      await publishJobEvent({
        userId,
        jobType: JOB_NAMES.SRT_FLIGHT_PATH,
        assetId,
        status: "processing",
        timestamp: new Date().toISOString(),
      });

      const srtBuffer = await readMediaFile(userId, assetId, "srt");
      if (!srtBuffer) {
        await markParseFailed(assetId);
        throw new Error("SRT sidecar file not found");
      }

      const { parserId, points } = parseSrt(srtBuffer.toString("utf8"));

      if (points.length === 0) {
        await markParseFailed(assetId);
        await publishJobEvent({
          userId,
          jobType: JOB_NAMES.SRT_FLIGHT_PATH,
          assetId,
          status: "complete",
          message: "Telemetry unparsed — format not recognized",
          timestamp: new Date().toISOString(),
        });
        logger.warn({ assetId, parserId }, "SRT format not recognized");
        return { assetId, parsed: false, parserId };
      }

      let totalDistance = 0;
      for (let index = 1; index < points.length; index += 1) {
        totalDistance += haversineMeters(points[index - 1], points[index]);
      }

      const maxAlt = Math.max(...points.map((point) => point.alt));
      const home = points[0];
      const durationSeconds =
        points.length > 1
          ? Math.max(0, (points.at(-1)!.startMs - points[0].startMs) / 1000)
          : 0;

      const [telemetryRow] = await db
        .insert(flightTelemetry)
        .values({
          assetId,
          parseStatus: "parsed",
          maxAltitudeMeters: String(maxAlt),
          totalDistanceMeters: String(totalDistance),
          flightDurationSeconds: String(durationSeconds),
          homePoint: `SRID=4326;POINT(${home.lng} ${home.lat})`,
          flightPath: buildLineString(points),
          rthEvents: [],
        })
        .onConflictDoUpdate({
          target: flightTelemetry.assetId,
          set: {
            parseStatus: "parsed",
            maxAltitudeMeters: String(maxAlt),
            totalDistanceMeters: String(totalDistance),
            flightDurationSeconds: String(durationSeconds),
            homePoint: `SRID=4326;POINT(${home.lng} ${home.lat})`,
            flightPath: buildLineString(points),
            updatedAt: new Date(),
          },
        })
        .returning({ id: flightTelemetry.id });

      await db.delete(telemetryPoints).where(eq(telemetryPoints.assetId, assetId));

      const sampled =
        points.length > 500
          ? points.filter((_, index) => index % Math.ceil(points.length / 500) === 0)
          : points;

      if (sampled.length > 0 && telemetryRow) {
        await db.insert(telemetryPoints).values(
          sampled.map((point, index) => {
            const prev = index > 0 ? sampled[index - 1]! : null;
            const speedMps =
              prev != null
                ? haversineMeters(prev, point) /
                  Math.max(0.001, (point.startMs - prev.startMs) / 1000)
                : null;
            return {
              assetId,
              flightTelemetryId: telemetryRow.id,
              point: `SRID=4326;POINT(${point.lng} ${point.lat})`,
              altitudeMeters: String(point.alt),
              speedMps: speedMps != null ? String(speedMps) : null,
              // Anchor to SRT timeline so video scrub sync uses startMs offsets
              recordedAt: new Date(point.startMs),
              sequenceIndex: index,
            };
          }),
        );
      }

      // Auto chapter markers from telemetry extrema
      await db.delete(videoChapters).where(eq(videoChapters.assetId, assetId));
      const maxAltPoint = points.reduce((best, point) =>
        point.alt > best.alt ? point : best,
      );
      await db.insert(videoChapters).values([
        {
          assetId,
          timestampOffsetMs: Math.max(0, maxAltPoint.startMs),
          label: "Max altitude reached",
          source: "auto" as const,
        },
      ]);

      const assetUpdates: Partial<typeof assets.$inferInsert> = {
        locationOriginal: `SRID=4326;POINT(${home.lng} ${home.lat})`,
        updatedAt: new Date(),
      };

      const firstClock = points.find((point) => point.wallClock)?.wallClock;
      if (firstClock) {
        assetUpdates.capturedAtOriginal = firstClock;
      }

      const camera = pickRepresentativeSrtCamera(points);
      if (hasSrtCameraFields(camera)) {
        const [existingAsset] = await db
          .select({
            assetType: assets.assetType,
            mediaMetadata: assets.mediaMetadata,
          })
          .from(assets)
          .where(eq(assets.id, assetId))
          .limit(1);

        if (existingAsset?.assetType === "video") {
          const existing =
            existingAsset.mediaMetadata?.kind === "video"
              ? existingAsset.mediaMetadata
              : ({
                  kind: "video",
                  durationSeconds: null,
                  width: null,
                  height: null,
                  bitrateBps: null,
                  frameRate: null,
                  iso: null,
                  exposureTimeSeconds: null,
                  fNumber: null,
                  exposureBias: null,
                  colorTemperatureK: null,
                  colorMode: null,
                  focalLengthMm: null,
                } satisfies VideoMediaMetadata);

          // SRT camera fields win; keep probe duration/dims/bitrate/fps.
          assetUpdates.mediaMetadata = mergeVideoMetadata(
            {
              ...existing,
              iso: camera!.iso,
              exposureTimeSeconds: camera!.exposureTimeSeconds,
              fNumber: camera!.fNumber,
              exposureBias: camera!.exposureBias,
              colorTemperatureK: camera!.colorTemperatureK,
              colorMode: camera!.colorMode,
              focalLengthMm: camera!.focalLengthMm,
            },
            existing,
          );
        }
      }

      await db
        .update(assets)
        .set(assetUpdates)
        .where(and(eq(assets.id, assetId), isNull(assets.deletedAt)));

      const { applyDefaultPreferredLutIfNeeded } = await import(
        "@/lib/luts/apply-default-preferred"
      );
      await applyDefaultPreferredLutIfNeeded(db, {
        userId,
        assetId,
        mediaMetadata:
          (assetUpdates.mediaMetadata as
            | import("@/lib/assets/media-metadata").MediaMetadata
            | undefined) ?? undefined,
        requeueThumbnail: true,
      });

      const flightId = await assignAssetToFlight(db, assetId);
      if (flightId) {
        await attachNearbyPhotosToFlight(db, flightId);
      }

      await publishJobEvent({
        userId,
        jobType: JOB_NAMES.SRT_FLIGHT_PATH,
        assetId,
        status: "complete",
        timestamp: new Date().toISOString(),
      });

      logger.info(
        {
          assetId,
          parserId,
          points: points.length,
          distanceMeters: totalDistance,
        },
        "SRT telemetry parsed",
      );
      return { assetId, parsed: true, parserId, points: points.length };
    },
    {
      connection,
      concurrency: config.jobs.concurrency.srtFlightPath,
    },
  );

  worker.on("failed", async (job, error) => {
    if (!job) return;
    const db = getWorkerDb();
    await db.insert(jobFailures).values({
      jobType: JOB_NAMES.SRT_FLIGHT_PATH,
      entityType: "asset",
      entityId: job.data.assetId,
      errorDetail: error.message,
      attemptCount: job.attemptsMade,
      payload: job.data as unknown as Record<string, unknown>,
    });
    await publishJobEvent({
      userId: job.data.userId,
      jobType: JOB_NAMES.SRT_FLIGHT_PATH,
      assetId: job.data.assetId,
      status: "failed",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  });

  return worker;
}
