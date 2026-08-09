import { and, eq, isNull, sql } from "drizzle-orm";

import { effectivePanoramaViewerSql } from "@/lib/drones/pano-sql";
import { getWebDb } from "@/lib/db";
import { assets, drones, flightTelemetry, flights } from "@/lib/db/schema";

export type DroneCompiledStats = {
  assetCount: number;
  /** Still photos that are not shown as 180°/360° panoramas. */
  photoCount: number;
  videoCount: number;
  pano180Count: number;
  pano360Count: number;
  flightCount: number;
  /** SRT-derived flight time across linked videos. */
  flightDurationSeconds: number;
  /** Container/recording duration across linked videos. */
  recordingDurationSeconds: number;
  /** Total path distance covered by recorded videos (SRT). */
  totalDistanceMeters: number;
  maxAltitudeMeters: number | null;
  favoriteCount: number;
  lastCapturedAt: string | null;
};

const panoMode = () => effectivePanoramaViewerSql();

/** Recompute cached airframe hours/distance from assets linked to this drone. */
export async function recomputeDroneFlightStats(droneId: string) {
  const db = getWebDb();
  const [agg] = await db
    .select({
      hours: sql<number>`coalesce(sum(${flightTelemetry.flightDurationSeconds}) / 3600.0, 0)`,
      distance: sql<number>`coalesce(sum(${flightTelemetry.totalDistanceMeters}), 0)`,
    })
    .from(assets)
    .leftJoin(flightTelemetry, eq(flightTelemetry.assetId, assets.id))
    .where(and(eq(assets.droneId, droneId), isNull(assets.deletedAt)));

  await db
    .update(drones)
    .set({
      totalFlightHours: String(Number(agg?.hours ?? 0).toFixed(2)),
      totalDistanceMeters: String(Number(agg?.distance ?? 0).toFixed(2)),
      updatedAt: new Date(),
    })
    .where(eq(drones.id, droneId));

  // Keep flights.droneId aligned with linked assets when possible.
  await db.execute(sql`
    update flights f
    set drone_id = ${droneId}, updated_at = now()
    where f.id in (
      select distinct a.flight_id
      from assets a
      where a.drone_id = ${droneId}
        and a.deleted_at is null
        and a.flight_id is not null
    )
  `);
}

export async function recomputeDroneFlightStatsForUser(
  userId: string,
  droneId: string | null | undefined,
) {
  if (!droneId) return;
  const db = getWebDb();
  const [owned] = await db
    .select({ id: drones.id })
    .from(drones)
    .where(and(eq(drones.id, droneId), eq(drones.userId, userId)))
    .limit(1);
  if (!owned) return;
  await recomputeDroneFlightStats(droneId);
}

export async function getCompiledStatsForDrone(
  userId: string,
  droneId: string,
): Promise<DroneCompiledStats> {
  const db = getWebDb();
  const mode = panoMode();
  const [row] = await db
    .select({
      assetCount: sql<number>`count(${assets.id})::int`,
      photoCount: sql<number>`count(*) filter (
        where ${assets.assetType} = 'photo' and ${mode} = 'photo'
      )::int`,
      videoCount: sql<number>`count(*) filter (where ${assets.assetType} = 'video')::int`,
      pano180Count: sql<number>`count(*) filter (where ${mode} = '180')::int`,
      pano360Count: sql<number>`count(*) filter (where ${mode} = '360')::int`,
      flightCount: sql<number>`count(distinct ${assets.flightId})::int`,
      flightDurationSeconds: sql<number>`coalesce(sum(${flightTelemetry.flightDurationSeconds}), 0)`,
      recordingDurationSeconds: sql<number>`coalesce(sum(
        case
          when ${assets.assetType} = 'video'
            and ${assets.mediaMetadata} ? 'durationSeconds'
          then nullif(${assets.mediaMetadata} ->> 'durationSeconds', '')::double precision
          else 0
        end
      ), 0)`,
      totalDistanceMeters: sql<number>`coalesce(sum(${flightTelemetry.totalDistanceMeters}), 0)`,
      maxAltitudeMeters: sql<number | null>`max(${flightTelemetry.maxAltitudeMeters})`,
      favoriteCount: sql<number>`count(*) filter (where ${assets.favorite} = true)::int`,
      lastCapturedAt: sql<Date | null>`max(coalesce(
        ${assets.capturedAtOverride},
        ${assets.capturedAtOriginal},
        ${assets.createdAt}
      ))`,
    })
    .from(assets)
    .leftJoin(flightTelemetry, eq(flightTelemetry.assetId, assets.id))
    .where(
      and(
        eq(assets.userId, userId),
        eq(assets.droneId, droneId),
        isNull(assets.deletedAt),
      ),
    );

  // Also count flights explicitly assigned to the drone that may have no assets yet.
  const [flightRow] = await db
    .select({
      flightCount: sql<number>`count(*)::int`,
    })
    .from(flights)
    .where(and(eq(flights.userId, userId), eq(flights.droneId, droneId)));

  const assetFlightCount = Number(row?.flightCount ?? 0);
  const explicitFlightCount = Number(flightRow?.flightCount ?? 0);

  return {
    assetCount: Number(row?.assetCount ?? 0),
    photoCount: Number(row?.photoCount ?? 0),
    videoCount: Number(row?.videoCount ?? 0),
    pano180Count: Number(row?.pano180Count ?? 0),
    pano360Count: Number(row?.pano360Count ?? 0),
    flightCount: Math.max(assetFlightCount, explicitFlightCount),
    flightDurationSeconds: Number(row?.flightDurationSeconds ?? 0),
    recordingDurationSeconds: Number(row?.recordingDurationSeconds ?? 0),
    totalDistanceMeters: Number(row?.totalDistanceMeters ?? 0),
    maxAltitudeMeters:
      row?.maxAltitudeMeters != null ? Number(row.maxAltitudeMeters) : null,
    favoriteCount: Number(row?.favoriteCount ?? 0),
    lastCapturedAt: row?.lastCapturedAt
      ? new Date(row.lastCapturedAt).toISOString()
      : null,
  };
}
