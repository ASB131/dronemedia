import { and, eq, isNull, sql } from "drizzle-orm";

import { buildGpx, buildKml } from "@/lib/assets/exports";
import { getWebDb } from "@/lib/db";
import { assets, flights, telemetryPoints } from "@/lib/db/schema";

export async function getFlightTrackForUser(
  userId: string,
  flightId: string,
) {
  const db = getWebDb();
  const [flight] = await db
    .select({
      id: flights.id,
      title: flights.title,
    })
    .from(flights)
    .where(and(eq(flights.id, flightId), eq(flights.userId, userId)))
    .limit(1);
  if (!flight) return null;

  const rows = await db
    .select({
      lat: sql<number>`ST_Y(${telemetryPoints.point})`,
      lng: sql<number>`ST_X(${telemetryPoints.point})`,
      altitudeMeters: telemetryPoints.altitudeMeters,
      recordedAt: telemetryPoints.recordedAt,
      sequenceIndex: telemetryPoints.sequenceIndex,
      assetId: telemetryPoints.assetId,
    })
    .from(telemetryPoints)
    .innerJoin(assets, eq(assets.id, telemetryPoints.assetId))
    .where(
      and(
        eq(assets.flightId, flightId),
        eq(assets.userId, userId),
        isNull(assets.deletedAt),
      ),
    )
    .orderBy(assets.createdAt, telemetryPoints.sequenceIndex);

  const points = rows.map((row) => ({
    lat: row.lat,
    lng: row.lng,
    alt: row.altitudeMeters ? Number(row.altitudeMeters) : 0,
    time: row.recordedAt,
  }));

  return {
    name: flight.title?.trim() || `Flight ${flight.id.slice(0, 8)}`,
    points,
  };
}

export async function exportFlightTrack(
  userId: string,
  flightId: string,
  format: "gpx" | "kml",
) {
  const track = await getFlightTrackForUser(userId, flightId);
  if (!track || track.points.length === 0) return null;
  const body =
    format === "gpx"
      ? buildGpx(track.name, track.points)
      : buildKml(track.name, track.points);
  return { name: track.name, body, format };
}
