import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { jsonError } from "@/lib/api/auth";
import type {
  LineStringGeoJson,
  TelemetrySeriesPoint,
} from "@/lib/assets/telemetry";
import { getWebDb } from "@/lib/db";
import { flightTelemetry, telemetryPoints } from "@/lib/db/schema";
import { getPublicAssetForUsername } from "@/lib/profiles/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public asset telemetry for the profile viewer.
 * Returns the full path/series (same timing as private /api/assets/.../telemetry)
 * so the live drone cursor stays synced with playback. Community map pins still
 * use separately fuzzed coordinates.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ username: string; assetId: string }> },
) {
  try {
    const { username, assetId } = await context.params;
    const asset = await getPublicAssetForUsername(username, assetId);
    if (!asset) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const wantSeries = new URL(request.url).searchParams.get("series") === "1";
    const db = getWebDb();

    const [row] = await db
      .select({
        pathJson: sql<string | null>`ST_AsGeoJSON(${flightTelemetry.flightPath})`,
        homeJson: sql<string | null>`ST_AsGeoJSON(${flightTelemetry.homePoint})`,
      })
      .from(flightTelemetry)
      .where(eq(flightTelemetry.assetId, assetId))
      .limit(1);

    const flightPath: LineStringGeoJson | null = row?.pathJson
      ? (JSON.parse(row.pathJson) as LineStringGeoJson)
      : null;

    let homePoint: { lat: number; lng: number } | null = null;
    if (row?.homeJson) {
      const parsed = JSON.parse(row.homeJson) as {
        type?: string;
        coordinates?: [number, number];
      };
      if (parsed?.type === "Point" && parsed.coordinates?.length >= 2) {
        homePoint = {
          lng: parsed.coordinates[0]!,
          lat: parsed.coordinates[1]!,
        };
      }
    }

    let series: TelemetrySeriesPoint[] | undefined;
    if (wantSeries) {
      const points = await db
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

      if (points.length === 0) {
        series = [];
      } else {
        const startMs = points[0]!.recordedAt.getTime();
        series = points.map((point) => ({
          lat: point.lat,
          lng: point.lng,
          altitudeMeters: point.altitudeMeters
            ? Number(point.altitudeMeters)
            : 0,
          offsetMs: Math.max(0, point.recordedAt.getTime() - startMs),
          // recordedAt is anchored to the SRT cue timestamp at ingest.
          srtTimeMs: Math.max(0, point.recordedAt.getTime()),
          speedMps: point.speedMps ? Number(point.speedMps) : null,
        }));
      }
    }

    return NextResponse.json({
      flightPath,
      homePoint,
      ...(wantSeries ? { series } : {}),
    });
  } catch (error) {
    return jsonError(error);
  }
}
