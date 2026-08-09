import { and, eq, isNull, sql } from "drizzle-orm";

import { getWebDb } from "@/lib/db";
import { assets, flightTelemetry } from "@/lib/db/schema";

export type LineStringGeoJson = {
  type: "LineString";
  coordinates: Array<[number, number]>;
};

export type PointGeoJson = {
  type: "Point";
  coordinates: [number, number];
};

export type TelemetryGeoJson = {
  flightPath: LineStringGeoJson | null;
};

export type TelemetrySeriesPoint = {
  lat: number;
  lng: number;
  altitudeMeters: number;
  /** Elapsed ms from the first telemetry sample of this asset. */
  offsetMs: number;
  /** Absolute cue time from the SRT timeline (e.g. 00:01:23 → 83000). */
  srtTimeMs: number;
  speedMps: number | null;
};

export async function getTelemetryGeoJsonForUser(
  userId: string,
  assetId: string,
): Promise<TelemetryGeoJson | null> {
  const db = getWebDb();

  const [row] = await db
    .select({
      pathJson: sql<string | null>`ST_AsGeoJSON(${flightTelemetry.flightPath})`,
    })
    .from(flightTelemetry)
    .innerJoin(assets, eq(assets.id, flightTelemetry.assetId))
    .where(
      and(
        eq(flightTelemetry.assetId, assetId),
        eq(assets.userId, userId),
        isNull(assets.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return null;

  return {
    flightPath: row.pathJson
      ? (JSON.parse(row.pathJson) as LineStringGeoJson)
      : null,
  };
}

export async function getTelemetrySeriesForUser(
  userId: string,
  assetId: string,
): Promise<TelemetrySeriesPoint[] | null> {
  const accessible = await import("@/lib/assets/access").then((m) =>
    m.getAccessibleAsset(userId, assetId),
  );
  if (!accessible) return null;

  const db = getWebDb();
  const { telemetryPoints } = await import("@/lib/db/schema");
  const rows = await db
    .select({
      lat: sql<number>`ST_Y(${telemetryPoints.point})`,
      lng: sql<number>`ST_X(${telemetryPoints.point})`,
      altitudeMeters: telemetryPoints.altitudeMeters,
      speedMps: telemetryPoints.speedMps,
      recordedAt: telemetryPoints.recordedAt,
      sequenceIndex: telemetryPoints.sequenceIndex,
    })
    .from(telemetryPoints)
    .where(eq(telemetryPoints.assetId, assetId))
    .orderBy(telemetryPoints.sequenceIndex);

  if (rows.length === 0) return [];

  const startMs = rows[0]!.recordedAt.getTime();
  return rows.map((row) => ({
    lat: row.lat,
    lng: row.lng,
    altitudeMeters: row.altitudeMeters ? Number(row.altitudeMeters) : 0,
    offsetMs: Math.max(0, row.recordedAt.getTime() - startMs),
    // recordedAt is anchored to the SRT cue timestamp (startMs) at ingest.
    srtTimeMs: Math.max(0, row.recordedAt.getTime()),
    speedMps: row.speedMps ? Number(row.speedMps) : null,
  }));
}
