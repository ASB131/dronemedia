import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { getEffectiveCaptureDate } from "@/lib/assets/capture";
import { getWebDb } from "@/lib/db";
import {
  assets,
  drones,
  flightTelemetry,
  flights,
  sequenceFrames,
  telemetryPoints,
} from "@/lib/db/schema";
import { deleteFlightIfNoAssets } from "@/lib/library/orphan-cleanup";

type AppDb = ReturnType<typeof getWebDb>;

/** Max gap between video assets when creating/joining auto-flights (ms). */
const FLIGHT_GAP_MS = 15 * 60 * 1000;

/**
 * Wider window for stills (photos / panos) joining an existing flight — people
 * often take stills well before/after a clip on the same outing.
 */
const PHOTO_ATTACH_GAP_MS = 90 * 60 * 1000;

function flightTitle(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Max distance between an asset and a peer on a candidate flight (meters). */
const FLIGHT_SPATIAL_METERS = 2_000;

export type AssignAssetToFlightOptions = {
  /**
   * When false, only attach to an existing auto-flight (used for photos so
   * geotagged stills do not spawn path-less flights).
   */
  createIfMissing?: boolean;
};

/**
 * Auto-assign an asset to a flight using compatible drone, time gap, and
 * optional spatial continuity when GPS is present (≤ 2 km).
 * Stills use a wider gap and never create flights when createIfMissing is false.
 */
export async function assignAssetToFlight(
  db: AppDb,
  assetId: string,
  options?: AssignAssetToFlightOptions,
) {
  const createIfMissing = options?.createIfMissing !== false;
  const gapMs = createIfMissing ? FLIGHT_GAP_MS : PHOTO_ATTACH_GAP_MS;

  const [asset] = await db
    .select({
      id: assets.id,
      userId: assets.userId,
      droneId: assets.droneId,
      flightId: assets.flightId,
      capturedAtOriginal: assets.capturedAtOriginal,
      capturedAtOverride: assets.capturedAtOverride,
      createdAt: assets.createdAt,
      lat: sql<number | null>`ST_Y(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
      lng: sql<number | null>`ST_X(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
    })
    .from(assets)
    .where(and(eq(assets.id, assetId), isNull(assets.deletedAt)))
    .limit(1);

  if (!asset) return null;
  // Already grouped — return id so callers (e.g. photo backfill) can continue.
  if (asset.flightId) return asset.flightId;

  const capturedAt = getEffectiveCaptureDate(asset);
  const windowStart = new Date(capturedAt.getTime() - gapMs);
  const windowEnd = new Date(capturedAt.getTime() + gapMs);

  // Untagged flights still match a tagged still (common when only EXIF had a model).
  const droneCondition = asset.droneId
    ? or(eq(flights.droneId, asset.droneId), isNull(flights.droneId))
    : isNull(flights.droneId);

  const candidates = await db
    .select({
      id: flights.id,
      startTime: flights.startTime,
      endTime: flights.endTime,
    })
    .from(flights)
    .where(
      and(
        eq(flights.userId, asset.userId),
        eq(flights.groupingMethod, "auto"),
        droneCondition,
        lte(flights.startTime, windowEnd),
        gte(sql`coalesce(${flights.endTime}, ${flights.startTime})`, windowStart),
      ),
    )
    .orderBy(desc(flights.startTime))
    .limit(20);

  let flightId: string | undefined;

  for (const candidate of candidates) {
    const start = candidate.startTime?.getTime() ?? 0;
    const end = candidate.endTime?.getTime() ?? start;
    const nearWindow =
      capturedAt.getTime() >= start - gapMs &&
      capturedAt.getTime() <= end + gapMs;
    if (!nearWindow) continue;

    if (asset.lat != null && asset.lng != null) {
      const [peer] = await db
        .select({
          lat: sql<number | null>`ST_Y(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
          lng: sql<number | null>`ST_X(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
        })
        .from(assets)
        .where(
          and(
            eq(assets.flightId, candidate.id),
            isNull(assets.deletedAt),
            sql`coalesce(${assets.locationOverride}, ${assets.locationOriginal}) is not null`,
          ),
        )
        .limit(1);

      if (peer?.lat != null && peer.lng != null) {
        const distance = haversineMeters(
          { lat: asset.lat, lng: asset.lng },
          { lat: peer.lat, lng: peer.lng },
        );
        if (distance > FLIGHT_SPATIAL_METERS) continue;
      }
    }

    flightId = candidate.id;
    break;
  }

  if (!flightId) {
    if (!createIfMissing) return null;
    const [created] = await db
      .insert(flights)
      .values({
        userId: asset.userId,
        droneId: asset.droneId,
        title: flightTitle(capturedAt),
        startTime: capturedAt,
        endTime: capturedAt,
        groupingMethod: "auto",
      })
      .returning({ id: flights.id });
    flightId = created.id;
  }

  await db
    .update(assets)
    .set({ flightId, updatedAt: new Date() })
    .where(eq(assets.id, assetId));

  await refreshFlightStats(db, flightId);
  return flightId;
}

/**
 * Pull unassigned photos / panoramas into an existing auto-flight using the
 * stills attach window (90 min) and 2 km spatial rule.
 */
export async function attachNearbyPhotosToFlight(db: AppDb, flightId: string) {
  const [flight] = await db
    .select({
      id: flights.id,
      userId: flights.userId,
      droneId: flights.droneId,
      startTime: flights.startTime,
      endTime: flights.endTime,
      groupingMethod: flights.groupingMethod,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight || flight.groupingMethod !== "auto" || !flight.startTime) {
    return 0;
  }

  const startMs = flight.startTime.getTime();
  const endMs = (flight.endTime ?? flight.startTime).getTime();
  const windowStart = new Date(startMs - PHOTO_ATTACH_GAP_MS);
  const windowEnd = new Date(endMs + PHOTO_ATTACH_GAP_MS);

  const [peer] = await db
    .select({
      lat: sql<number | null>`ST_Y(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
      lng: sql<number | null>`ST_X(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
    })
    .from(assets)
    .where(
      and(
        eq(assets.flightId, flightId),
        isNull(assets.deletedAt),
        sql`coalesce(${assets.locationOverride}, ${assets.locationOriginal}) is not null`,
      ),
    )
    .limit(1);

  const droneCondition = flight.droneId
    ? or(eq(assets.droneId, flight.droneId), isNull(assets.droneId))
    : sql`true`;

  const photoRows = await db
    .select({
      id: assets.id,
      capturedAtOriginal: assets.capturedAtOriginal,
      capturedAtOverride: assets.capturedAtOverride,
      createdAt: assets.createdAt,
      lat: sql<number | null>`ST_Y(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
      lng: sql<number | null>`ST_X(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
    })
    .from(assets)
    .where(
      and(
        eq(assets.userId, flight.userId),
        or(
          eq(assets.assetType, "photo"),
          and(
            eq(assets.assetType, "sequence"),
            eq(assets.sequenceKind, "panorama"),
          ),
        ),
        isNull(assets.flightId),
        isNull(assets.deletedAt),
        droneCondition,
        gte(
          sql`coalesce(${assets.capturedAtOverride}, ${assets.capturedAtOriginal}, ${assets.createdAt})`,
          windowStart,
        ),
        lte(
          sql`coalesce(${assets.capturedAtOverride}, ${assets.capturedAtOriginal}, ${assets.createdAt})`,
          windowEnd,
        ),
      ),
    )
    .orderBy(asc(assets.createdAt))
    .limit(200);

  const toAttach: string[] = [];
  for (const photo of photoRows) {
    const capturedAt = getEffectiveCaptureDate(photo);
    const ts = capturedAt.getTime();
    if (ts < startMs - PHOTO_ATTACH_GAP_MS || ts > endMs + PHOTO_ATTACH_GAP_MS)
      continue;

    if (
      photo.lat != null &&
      photo.lng != null &&
      peer?.lat != null &&
      peer.lng != null
    ) {
      const distance = haversineMeters(
        { lat: photo.lat, lng: photo.lng },
        { lat: peer.lat, lng: peer.lng },
      );
      if (distance > FLIGHT_SPATIAL_METERS) continue;
    }

    toAttach.push(photo.id);
  }

  if (toAttach.length === 0) return 0;

  await db
    .update(assets)
    .set({ flightId, updatedAt: new Date() })
    .where(and(inArray(assets.id, toAttach), isNull(assets.deletedAt)));

  await refreshFlightStats(db, flightId);
  return toAttach.length;
}

/**
 * Keep flight.droneId and every linked asset on the same drone.
 * If `preferredDroneId` is provided it wins (pass null to clear all).
 * Otherwise uses the flight's drone, else the first asset that has one.
 */
export async function syncFlightDroneAssignment(
  db: AppDb,
  flightId: string,
  preferredDroneId?: string | null,
) {
  const [flight] = await db
    .select({ id: flights.id, droneId: flights.droneId })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);
  if (!flight) return;

  const linked = await db
    .select({ id: assets.id, droneId: assets.droneId })
    .from(assets)
    .where(and(eq(assets.flightId, flightId), isNull(assets.deletedAt)));

  const chosen =
    preferredDroneId !== undefined
      ? preferredDroneId
      : (flight.droneId ??
        linked.find((row) => row.droneId)?.droneId ??
        null);

  if (flight.droneId !== chosen) {
    await db
      .update(flights)
      .set({ droneId: chosen, updatedAt: new Date() })
      .where(eq(flights.id, flightId));
  }

  if (linked.some((row) => row.droneId !== chosen)) {
    await db
      .update(assets)
      .set({ droneId: chosen, updatedAt: new Date() })
      .where(and(eq(assets.flightId, flightId), isNull(assets.deletedAt)));
  }
}

export async function refreshFlightStats(db: AppDb, flightId: string) {
  await syncFlightDroneAssignment(db, flightId);

  const linkedAssets = await db
    .select({
      id: assets.id,
      capturedAtOriginal: assets.capturedAtOriginal,
      capturedAtOverride: assets.capturedAtOverride,
      createdAt: assets.createdAt,
    })
    .from(assets)
    .where(and(eq(assets.flightId, flightId), isNull(assets.deletedAt)));

  if (linkedAssets.length === 0) return;

  const captureTimes = linkedAssets.map((asset) =>
    getEffectiveCaptureDate(asset).getTime(),
  );
  const startTime = new Date(Math.min(...captureTimes));
  const endTime = new Date(Math.max(...captureTimes));

  const assetIds = linkedAssets.map((asset) => asset.id);
  const [telemetryAgg] =
    assetIds.length > 0
      ? await db
          .select({
            maxAltitude: sql<string | null>`max(${flightTelemetry.maxAltitudeMeters})`,
            totalDistance: sql<string | null>`sum(${flightTelemetry.totalDistanceMeters})`,
            totalDuration: sql<string | null>`sum(${flightTelemetry.flightDurationSeconds})`,
          })
          .from(flightTelemetry)
          .where(inArray(flightTelemetry.assetId, assetIds))
      : [null];

  const [flightRow] = await db
    .update(flights)
    .set({
      startTime,
      endTime,
      title: flightTitle(startTime),
      maxAltitudeMeters: telemetryAgg?.maxAltitude ?? null,
      totalDistanceMeters: telemetryAgg?.totalDistance ?? null,
      totalDurationSeconds: telemetryAgg?.totalDuration ?? null,
      updatedAt: new Date(),
    })
    .where(eq(flights.id, flightId))
    .returning({ droneId: flights.droneId });

  const droneIds = new Set<string>();
  if (flightRow?.droneId) droneIds.add(flightRow.droneId);

  const linkedDroneRows = await db
    .select({ droneId: assets.droneId })
    .from(assets)
    .where(and(eq(assets.flightId, flightId), isNull(assets.deletedAt)));
  for (const row of linkedDroneRows) {
    if (row.droneId) droneIds.add(row.droneId);
  }

  if (droneIds.size > 0) {
    const { recomputeDroneFlightStats } = await import("@/lib/drones/stats");
    for (const droneId of droneIds) {
      await recomputeDroneFlightStats(droneId);
    }
  }
}

export type FlightSummaryDto = {
  id: string;
  title: string | null;
  startTime: string | null;
  endTime: string | null;
  assetCount: number;
  totalDistanceMeters: number | null;
  maxAltitudeMeters: number | null;
  totalDurationSeconds: number | null;
  droneId: string | null;
  droneName: string | null;
  coverAssetId: string | null;
  /** Representative GPS from a linked asset (for suggestions / map). */
  location: { lat: number; lng: number } | null;
};

export async function listFlightsForUser(
  userId: string,
): Promise<FlightSummaryDto[]> {
  const db = getWebDb();
  const rows = await db
    .select({
      id: flights.id,
      title: flights.title,
      startTime: flights.startTime,
      endTime: flights.endTime,
      totalDistanceMeters: flights.totalDistanceMeters,
      maxAltitudeMeters: flights.maxAltitudeMeters,
      totalDurationSeconds: flights.totalDurationSeconds,
      droneId: flights.droneId,
      droneName: drones.name,
      assetCount: sql<number>`count(${assets.id})::int`,
      coverAssetId: sql<string | null>`(
        select cover.id
        from assets cover
        where cover.flight_id = ${flights.id}
          and cover.deleted_at is null
        order by coalesce(cover.captured_at_override, cover.captured_at_original) asc nulls last
        limit 1
      )`,
      locationLat: sql<number | null>`(
        select ST_Y(coalesce(cover.location_override, cover.location_original))
        from assets cover
        where cover.flight_id = ${flights.id}
          and cover.deleted_at is null
          and coalesce(cover.location_override, cover.location_original) is not null
        order by coalesce(cover.captured_at_override, cover.captured_at_original) asc nulls last
        limit 1
      )`,
      locationLng: sql<number | null>`(
        select ST_X(coalesce(cover.location_override, cover.location_original))
        from assets cover
        where cover.flight_id = ${flights.id}
          and cover.deleted_at is null
          and coalesce(cover.location_override, cover.location_original) is not null
        order by coalesce(cover.captured_at_override, cover.captured_at_original) asc nulls last
        limit 1
      )`,
    })
    .from(flights)
    .leftJoin(drones, eq(drones.id, flights.droneId))
    .leftJoin(
      assets,
      and(eq(assets.flightId, flights.id), isNull(assets.deletedAt)),
    )
    .where(eq(flights.userId, userId))
    .groupBy(flights.id, drones.name)
    .having(sql`count(${assets.id}) > 0`)
    .orderBy(desc(flights.startTime));

  return rows
    .filter((row) => row.assetCount > 0)
    .map((row) => ({
      id: row.id,
      title: row.title,
      startTime: row.startTime?.toISOString() ?? null,
      endTime: row.endTime?.toISOString() ?? null,
      assetCount: row.assetCount,
      totalDistanceMeters:
        row.totalDistanceMeters != null
          ? Number(row.totalDistanceMeters)
          : null,
      maxAltitudeMeters:
        row.maxAltitudeMeters != null ? Number(row.maxAltitudeMeters) : null,
      totalDurationSeconds:
        row.totalDurationSeconds != null
          ? Number(row.totalDurationSeconds)
          : null,
      droneId: row.droneId,
      droneName: row.droneName ?? null,
      coverAssetId: row.coverAssetId,
      location:
        row.locationLat != null && row.locationLng != null
          ? { lat: Number(row.locationLat), lng: Number(row.locationLng) }
          : null,
    }));
}

export type FlightDetailDto = {
  id: string;
  title: string | null;
  startTime: string | null;
  endTime: string | null;
  totalDistanceMeters: number | null;
  maxAltitudeMeters: number | null;
  totalDurationSeconds: number | null;
  droneId: string | null;
  droneName: string | null;
  assets: Array<{
    id: string;
    displayName: string;
    assetType: "photo" | "video" | "sequence";
    sequenceKind: "hyperlapse" | "panorama" | null;
    /** Lowest sequence frame index when tiles exist (for flight strip/preview). */
    firstFrameIndex: number | null;
    capturedAt: string;
    location: { lat: number; lng: number } | null;
  }>;
  combinedPath: {
    type: "LineString";
    coordinates: Array<[number, number]>;
  } | null;
  combinedSeries: Array<{
    assetId: string;
    lat: number;
    lng: number;
    altitudeMeters: number;
    offsetMs: number;
    assetOffsetMs: number;
    srtTimeMs: number;
    speedMps: number | null;
  }>;
};

export async function getFlightForUser(
  userId: string,
  flightId: string,
): Promise<FlightDetailDto | null> {
  const db = getWebDb();
  const [owned] = await db
    .select({ id: flights.id })
    .from(flights)
    .where(and(eq(flights.id, flightId), eq(flights.userId, userId)))
    .limit(1);
  if (!owned) return null;

  // Propagate any asset/flight drone to the whole session before reading assets.
  await syncFlightDroneAssignment(db, flightId);

  const [flightRow] = await db
    .select({
      id: flights.id,
      title: flights.title,
      startTime: flights.startTime,
      endTime: flights.endTime,
      totalDistanceMeters: flights.totalDistanceMeters,
      maxAltitudeMeters: flights.maxAltitudeMeters,
      totalDurationSeconds: flights.totalDurationSeconds,
      droneId: flights.droneId,
      droneName: drones.name,
    })
    .from(flights)
    .leftJoin(drones, eq(drones.id, flights.droneId))
    .where(and(eq(flights.id, flightId), eq(flights.userId, userId)))
    .limit(1);
  if (!flightRow) return null;

  const linked = await db
    .select({
      id: assets.id,
      displayName: assets.displayName,
      assetType: assets.assetType,
      sequenceKind: assets.sequenceKind,
      capturedAtOriginal: assets.capturedAtOriginal,
      capturedAtOverride: assets.capturedAtOverride,
      createdAt: assets.createdAt,
      lat: sql<number | null>`ST_Y(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
      lng: sql<number | null>`ST_X(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
      pathJson: sql<string | null>`ST_AsGeoJSON(${flightTelemetry.flightPath})`,
      firstFrameIndex: sql<number | null>`(
        select min(${sequenceFrames.frameIndex})
        from ${sequenceFrames}
        where ${sequenceFrames.assetId} = ${assets.id}
      )`,
    })
    .from(assets)
    .leftJoin(flightTelemetry, eq(flightTelemetry.assetId, assets.id))
    .where(and(eq(assets.flightId, flightId), isNull(assets.deletedAt)))
    .orderBy(asc(assets.capturedAtOriginal));

  const combinedPath: Array<[number, number]> = [];
  for (const asset of linked) {
    if (!asset.pathJson) continue;
    const geo = JSON.parse(asset.pathJson) as {
      coordinates?: Array<[number, number]>;
    };
    for (const coord of geo.coordinates ?? []) combinedPath.push(coord);
  }

  const assetIds = linked.map((asset) => asset.id);
  const combinedSeries: FlightDetailDto["combinedSeries"] = [];
  if (assetIds.length > 0) {
    const pointRows = await db
      .select({
        assetId: telemetryPoints.assetId,
        lat: sql<number>`ST_Y(${telemetryPoints.point})`,
        lng: sql<number>`ST_X(${telemetryPoints.point})`,
        altitudeMeters: telemetryPoints.altitudeMeters,
        speedMps: telemetryPoints.speedMps,
        recordedAt: telemetryPoints.recordedAt,
        sequenceIndex: telemetryPoints.sequenceIndex,
      })
      .from(telemetryPoints)
      .where(inArray(telemetryPoints.assetId, assetIds))
      .orderBy(asc(telemetryPoints.recordedAt), asc(telemetryPoints.sequenceIndex));

    const startMs = pointRows[0]?.recordedAt.getTime() ?? 0;
    const assetStartMs = new Map<string, number>();
    for (const row of pointRows) {
      if (!assetStartMs.has(row.assetId)) {
        assetStartMs.set(row.assetId, row.recordedAt.getTime());
      }
      const assetStart = assetStartMs.get(row.assetId)!;
      combinedSeries.push({
        assetId: row.assetId,
        lat: row.lat,
        lng: row.lng,
        altitudeMeters: row.altitudeMeters ? Number(row.altitudeMeters) : 0,
        offsetMs: Math.max(0, row.recordedAt.getTime() - startMs),
        assetOffsetMs: Math.max(0, row.recordedAt.getTime() - assetStart),
        srtTimeMs: Math.max(0, row.recordedAt.getTime()),
        speedMps: row.speedMps ? Number(row.speedMps) : null,
      });
    }
  }

  return {
    id: flightRow.id,
    title: flightRow.title,
    startTime: flightRow.startTime?.toISOString() ?? null,
    endTime: flightRow.endTime?.toISOString() ?? null,
    totalDistanceMeters:
      flightRow.totalDistanceMeters != null
        ? Number(flightRow.totalDistanceMeters)
        : null,
    maxAltitudeMeters:
      flightRow.maxAltitudeMeters != null
        ? Number(flightRow.maxAltitudeMeters)
        : null,
    totalDurationSeconds:
      flightRow.totalDurationSeconds != null
        ? Number(flightRow.totalDurationSeconds)
        : null,
    droneId: flightRow.droneId,
    droneName: flightRow.droneName ?? null,
    assets: linked.map((asset) => ({
      id: asset.id,
      displayName: asset.displayName,
      assetType: asset.assetType,
      sequenceKind: asset.sequenceKind ?? null,
      firstFrameIndex:
        asset.firstFrameIndex != null ? Number(asset.firstFrameIndex) : null,
      capturedAt: getEffectiveCaptureDate(asset).toISOString(),
      location:
        asset.lat != null && asset.lng != null
          ? { lat: Number(asset.lat), lng: Number(asset.lng) }
          : null,
    })),
    combinedPath:
      combinedPath.length > 0
        ? { type: "LineString", coordinates: combinedPath }
        : null,
    combinedSeries,
  };
}

export async function mergeFlights(
  userId: string,
  targetFlightId: string,
  sourceFlightIds: string[],
) {
  const db = getWebDb();
  const [target] = await db
    .select({ id: flights.id })
    .from(flights)
    .where(and(eq(flights.id, targetFlightId), eq(flights.userId, userId)))
    .limit(1);
  if (!target) return null;

  for (const sourceId of sourceFlightIds) {
    if (sourceId === targetFlightId) continue;
    await db
      .update(assets)
      .set({ flightId: targetFlightId, updatedAt: new Date() })
      .where(and(eq(assets.flightId, sourceId), eq(assets.userId, userId)));
    await db
      .delete(flights)
      .where(and(eq(flights.id, sourceId), eq(flights.userId, userId)));
  }

  await refreshFlightStats(db, targetFlightId);
  return { flightId: targetFlightId };
}

export async function splitAssetToNewFlight(userId: string, assetId: string) {
  const db = getWebDb();
  const [asset] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.userId, userId)))
    .limit(1);
  if (!asset?.flightId) return null;

  const oldFlightId = asset.flightId;
  const capturedAt = getEffectiveCaptureDate(asset);
  const [created] = await db
    .insert(flights)
    .values({
      userId,
      droneId: asset.droneId,
      title: flightTitle(capturedAt),
      startTime: capturedAt,
      endTime: capturedAt,
      groupingMethod: "manual",
    })
    .returning({ id: flights.id });

  await db
    .update(assets)
    .set({ flightId: created.id, updatedAt: new Date() })
    .where(eq(assets.id, assetId));

  await refreshFlightStats(db, created.id);
  await refreshFlightStats(db, oldFlightId);

  await deleteFlightIfNoAssets(db, oldFlightId);

  return { flightId: created.id };
}

export async function reassignAssetToFlight(
  userId: string,
  assetId: string,
  targetFlightId: string | null,
) {
  const db = getWebDb();
  const [asset] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.userId, userId)))
    .limit(1);
  if (!asset) return null;

  if (targetFlightId) {
    const [target] = await db
      .select({ id: flights.id })
      .from(flights)
      .where(and(eq(flights.id, targetFlightId), eq(flights.userId, userId)))
      .limit(1);
    if (!target) return null;
  }

  const oldFlightId = asset.flightId;
  await db
    .update(assets)
    .set({ flightId: targetFlightId, updatedAt: new Date() })
    .where(eq(assets.id, assetId));

  if (targetFlightId) {
    // Prefer the moved asset's drone when set; otherwise inherit from peers.
    await syncFlightDroneAssignment(
      db,
      targetFlightId,
      asset.droneId ?? undefined,
    );
    await refreshFlightStats(db, targetFlightId);
  }
  if (oldFlightId) {
    await refreshFlightStats(db, oldFlightId);
    await deleteFlightIfNoAssets(db, oldFlightId);
  }
  return { flightId: targetFlightId };
}

export type PhotoClipContextDto = {
  videoId: string;
  videoDisplayName: string;
  seekSeconds: number;
  match: "spatial" | "temporal";
};

/**
 * For a photo on a flight, find the best sibling video clip and a seek time
 * where the photo was likely taken (nearest path point, else capture-time delta).
 */
export async function getPhotoClipContextForUser(
  userId: string,
  photoId: string,
): Promise<PhotoClipContextDto | null> {
  const db = getWebDb();
  const [photo] = await db
    .select({
      id: assets.id,
      flightId: assets.flightId,
      assetType: assets.assetType,
      sequenceKind: assets.sequenceKind,
      capturedAtOriginal: assets.capturedAtOriginal,
      capturedAtOverride: assets.capturedAtOverride,
      createdAt: assets.createdAt,
      lat: sql<number | null>`ST_Y(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
      lng: sql<number | null>`ST_X(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
    })
    .from(assets)
    .where(
      and(
        eq(assets.id, photoId),
        eq(assets.userId, userId),
        isNull(assets.deletedAt),
      ),
    )
    .limit(1);

  if (!photo?.flightId) return null;
  const isStill =
    photo.assetType === "photo" ||
    (photo.assetType === "sequence" && photo.sequenceKind === "panorama");
  if (!isStill) return null;

  const videos = await db
    .select({
      id: assets.id,
      displayName: assets.displayName,
      capturedAtOriginal: assets.capturedAtOriginal,
      capturedAtOverride: assets.capturedAtOverride,
      createdAt: assets.createdAt,
      durationSeconds: sql<number | null>`(
        case
          when ${assets.mediaMetadata} ? 'durationSeconds'
          then (${assets.mediaMetadata}->>'durationSeconds')::float
          else null
        end
      )`,
    })
    .from(assets)
    .where(
      and(
        eq(assets.flightId, photo.flightId),
        eq(assets.userId, userId),
        eq(assets.assetType, "video"),
        isNull(assets.deletedAt),
      ),
    );

  if (videos.length === 0) return null;

  const photoCaptured = getEffectiveCaptureDate(photo).getTime();
  const photoLoc =
    photo.lat != null && photo.lng != null
      ? { lat: photo.lat, lng: photo.lng }
      : null;

  let bestSpatial: PhotoClipContextDto | null = null;
  let bestSpatialDist = Number.POSITIVE_INFINITY;

  if (photoLoc) {
    for (const video of videos) {
      const points = await db
        .select({
          lat: sql<number>`ST_Y(${telemetryPoints.point})`,
          lng: sql<number>`ST_X(${telemetryPoints.point})`,
          recordedAt: telemetryPoints.recordedAt,
        })
        .from(telemetryPoints)
        .where(eq(telemetryPoints.assetId, video.id))
        .orderBy(telemetryPoints.sequenceIndex);

      if (points.length === 0) continue;
      const startMs = points[0]!.recordedAt.getTime();
      for (const point of points) {
        const dist = haversineMeters(photoLoc, {
          lat: point.lat,
          lng: point.lng,
        });
        if (dist < bestSpatialDist && dist <= 75) {
          bestSpatialDist = dist;
          bestSpatial = {
            videoId: video.id,
            videoDisplayName: video.displayName,
            seekSeconds: Math.max(
              0,
              (point.recordedAt.getTime() - startMs) / 1000,
            ),
            match: "spatial",
          };
        }
      }
    }
  }

  if (bestSpatial) return bestSpatial;

  for (const video of videos) {
    const videoStart = getEffectiveCaptureDate(video).getTime();
    const durationMs =
      video.durationSeconds != null && Number.isFinite(video.durationSeconds)
        ? Math.max(0, video.durationSeconds * 1000)
        : 15 * 60 * 1000;
    const delta = photoCaptured - videoStart;
    if (delta >= -5_000 && delta <= durationMs + 5_000) {
      return {
        videoId: video.id,
        videoDisplayName: video.displayName,
        seekSeconds: Math.min(Math.max(delta / 1000, 0), durationMs / 1000),
        match: "temporal",
      };
    }
  }

  return null;
}
