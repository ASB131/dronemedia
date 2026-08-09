import { eq, sql } from "drizzle-orm";

import { getOwnedAsset } from "@/lib/assets/access";
import { getWebDb } from "@/lib/db";
import { telemetryPoints, videoChapters } from "@/lib/db/schema";

export type VideoChapterDto = {
  id: string;
  timestampOffsetMs: number;
  label: string;
  source: "auto" | "manual";
};

export async function listChaptersForAsset(
  userId: string,
  assetId: string,
): Promise<VideoChapterDto[]> {
  const owned = await getOwnedAsset(userId, assetId);
  if (!owned) return [];

  const db = getWebDb();
  const rows = await db
    .select({
      id: videoChapters.id,
      timestampOffsetMs: videoChapters.timestampOffsetMs,
      label: videoChapters.label,
      source: videoChapters.source,
    })
    .from(videoChapters)
    .where(eq(videoChapters.assetId, assetId))
    .orderBy(videoChapters.timestampOffsetMs);

  return rows;
}

export async function getTelemetryCsvForUser(userId: string, assetId: string) {
  const owned = await getOwnedAsset(userId, assetId);
  if (!owned) return null;

  const db = getWebDb();
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

  const header = "sequence,timestamp,lat,lng,altitude_m,speed_mps";
  const lines = rows.map((row) =>
    [
      row.sequenceIndex,
      row.recordedAt?.toISOString() ?? "",
      row.lat,
      row.lng,
      row.altitudeMeters ?? "",
      row.speedMps ?? "",
    ].join(","),
  );
  return [header, ...lines].join("\n");
}

export async function getTelemetryTrackForUser(
  userId: string,
  assetId: string,
): Promise<Array<{ lat: number; lng: number; alt: number; time: Date | null }> | null> {
  const owned = await getOwnedAsset(userId, assetId);
  if (!owned) return null;

  const db = getWebDb();
  const rows = await db
    .select({
      lat: sql<number>`ST_Y(${telemetryPoints.point})`,
      lng: sql<number>`ST_X(${telemetryPoints.point})`,
      altitudeMeters: telemetryPoints.altitudeMeters,
      recordedAt: telemetryPoints.recordedAt,
    })
    .from(telemetryPoints)
    .where(eq(telemetryPoints.assetId, assetId))
    .orderBy(telemetryPoints.sequenceIndex);

  return rows.map((row) => ({
    lat: row.lat,
    lng: row.lng,
    alt: row.altitudeMeters ? Number(row.altitudeMeters) : 0,
    time: row.recordedAt,
  }));
}

export function buildGpx(
  name: string,
  points: Array<{ lat: number; lng: number; alt: number; time: Date | null }>,
) {
  const trkpts = points
    .map((point) => {
      const time = point.time
        ? `<time>${point.time.toISOString()}</time>`
        : "";
      return `<trkpt lat="${point.lat}" lon="${point.lng}"><ele>${point.alt}</ele>${time}</trkpt>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Drone Media" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>${escapeXml(name)}</name><trkseg>${trkpts}</trkseg></trk>
</gpx>`;
}

export function buildKml(
  name: string,
  points: Array<{ lat: number; lng: number; alt: number }>,
) {
  const coords = points
    .map((point) => `${point.lng},${point.lat},${point.alt}`)
    .join(" ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(name)}</name>
    <Placemark>
      <name>${escapeXml(name)}</name>
      <LineString>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>${coords}</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function listUnresolvedJobFailures(limit = 50) {
  const db = getWebDb();
  const { jobFailures } = await import("@/lib/db/schema");
  return db
    .select()
    .from(jobFailures)
    .where(eq(jobFailures.resolved, false))
    .orderBy(sql`${jobFailures.createdAt} desc`)
    .limit(limit);
}

export async function resolveJobFailure(failureId: string) {
  const db = getWebDb();
  const { jobFailures } = await import("@/lib/db/schema");
  const [row] = await db
    .update(jobFailures)
    .set({ resolved: true, resolvedAt: new Date() })
    .where(eq(jobFailures.id, failureId))
    .returning({ id: jobFailures.id });
  return row ?? null;
}

export async function listAuditLogs(limit = 100) {
  const db = getWebDb();
  const { auditLogs, users } = await import("@/lib/db/schema");
  return db
    .select({
      id: auditLogs.id,
      actionType: auditLogs.actionType,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      actorUsername: users.username,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .orderBy(sql`${auditLogs.createdAt} desc`)
    .limit(limit);
}
