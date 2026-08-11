import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

import type { MediaMetadata } from "@/lib/assets/media-metadata";
import { getEffectiveCaptureDate } from "@/lib/assets/capture";
import { panoramaViewerBadgeLabel } from "@/lib/assets/panorama-viewer-mode";
import { effectivePanoramaViewerSql } from "@/lib/drones/pano-sql";
import {
  getCompiledStatsForDrone,
  type DroneCompiledStats,
} from "@/lib/drones/stats";
import { getWebDb } from "@/lib/db";
import { assets, drones, flightTelemetry } from "@/lib/db/schema";

export type DroneDto = {
  id: string;
  name: string;
  model: string | null;
  serialNumber: string | null;
  createdAt: string;
  coverAssetId: string | null;
} & DroneCompiledStats & {
    /** Hours derived from SRT flight duration. */
    totalFlightHours: number;
  };

export type DroneAssetDto = {
  id: string;
  displayName: string;
  assetType: "photo" | "video" | "sequence";
  sequenceKind: "hyperlapse" | "panorama" | null;
  capturedAt: string | null;
  panoramaBadge: string | null;
};

export async function listDronesForUser(userId: string): Promise<DroneDto[]> {
  const db = getWebDb();
  const mode = effectivePanoramaViewerSql();
  const rows = await db
    .select({
      id: drones.id,
      name: drones.name,
      model: drones.model,
      serialNumber: drones.serialNumber,
      createdAt: drones.createdAt,
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
      coverAssetId: sql<string | null>`(
        select a.id
        from assets a
        where a.drone_id = ${drones.id}
          and a.user_id = ${userId}
          and a.deleted_at is null
        order by coalesce(a.captured_at_override, a.captured_at_original) desc nulls last
        limit 1
      )`,
    })
    .from(drones)
    .leftJoin(
      assets,
      and(
        eq(assets.droneId, drones.id),
        eq(assets.userId, userId),
        isNull(assets.deletedAt),
      ),
    )
    .leftJoin(flightTelemetry, eq(flightTelemetry.assetId, assets.id))
    .where(eq(drones.userId, userId))
    .groupBy(drones.id)
    .orderBy(desc(drones.createdAt));

  return rows.map((row) => {
    const flightDurationSeconds = Number(row.flightDurationSeconds ?? 0);
    return {
      id: row.id,
      name: row.name,
      model: row.model,
      serialNumber: row.serialNumber,
      createdAt: row.createdAt.toISOString(),
      coverAssetId: row.coverAssetId,
      assetCount: Number(row.assetCount ?? 0),
      photoCount: Number(row.photoCount ?? 0),
      videoCount: Number(row.videoCount ?? 0),
      pano180Count: Number(row.pano180Count ?? 0),
      pano360Count: Number(row.pano360Count ?? 0),
      flightCount: Number(row.flightCount ?? 0),
      flightDurationSeconds,
      recordingDurationSeconds: Number(row.recordingDurationSeconds ?? 0),
      totalDistanceMeters: Number(row.totalDistanceMeters ?? 0),
      maxAltitudeMeters:
        row.maxAltitudeMeters != null ? Number(row.maxAltitudeMeters) : null,
      favoriteCount: Number(row.favoriteCount ?? 0),
      lastCapturedAt: row.lastCapturedAt
        ? new Date(row.lastCapturedAt).toISOString()
        : null,
      totalFlightHours: flightDurationSeconds / 3600,
    };
  });
}

type DroneAssetCursor = {
  capturedAt: string;
  id: string;
};

function decodeDroneAssetCursor(cursor: string): DroneAssetCursor {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("capturedAt" in parsed) ||
      !("id" in parsed) ||
      typeof (parsed as DroneAssetCursor).capturedAt !== "string" ||
      typeof (parsed as DroneAssetCursor).id !== "string"
    ) {
      throw new Error("Invalid drone asset cursor");
    }
    const capturedAt = new Date((parsed as DroneAssetCursor).capturedAt);
    if (Number.isNaN(capturedAt.getTime())) {
      throw new Error("Invalid drone asset cursor");
    }
    return {
      capturedAt: (parsed as DroneAssetCursor).capturedAt,
      id: (parsed as DroneAssetCursor).id,
    };
  } catch {
    throw new Error("Invalid drone asset cursor");
  }
}

function encodeDroneAssetCursor(row: {
  id: string;
  capturedAtOverride: Date | null;
  capturedAtOriginal: Date | null;
  createdAt: Date;
}): string {
  return Buffer.from(
    JSON.stringify({
      capturedAt: getEffectiveCaptureDate(row).toISOString(),
      id: row.id,
    }),
  ).toString("base64url");
}

export async function listAssetsForDrone(
  userId: string,
  droneId: string,
  options?: { limit?: number; cursor?: string },
): Promise<{ assets: DroneAssetDto[]; nextCursor: string | null } | null> {
  const db = getWebDb();
  const [owned] = await db
    .select({ id: drones.id })
    .from(drones)
    .where(and(eq(drones.id, droneId), eq(drones.userId, userId)))
    .limit(1);
  if (!owned) return null;

  const limit = Math.min(Math.max(options?.limit ?? 48, 1), 100);
  const capturedAtExpr = sql`coalesce(${assets.capturedAtOverride}, ${assets.capturedAtOriginal}, ${assets.createdAt})`;
  const conditions = [
    eq(assets.userId, userId),
    eq(assets.droneId, droneId),
    isNull(assets.deletedAt),
  ];

  if (options?.cursor) {
    const cursor = decodeDroneAssetCursor(options.cursor);
    const cursorCapturedAt = new Date(cursor.capturedAt);
    conditions.push(
      or(
        sql`${capturedAtExpr} < ${cursorCapturedAt}`,
        and(
          sql`${capturedAtExpr} = ${cursorCapturedAt}`,
          sql`${assets.id} < ${cursor.id}`,
        ),
      )!,
    );
  }

  const rows = await db
    .select({
      id: assets.id,
      displayName: assets.displayName,
      assetType: assets.assetType,
      sequenceKind: assets.sequenceKind,
      mediaMetadata: assets.mediaMetadata,
      capturedAtOverride: assets.capturedAtOverride,
      capturedAtOriginal: assets.capturedAtOriginal,
      createdAt: assets.createdAt,
    })
    .from(assets)
    .where(and(...conditions))
    .orderBy(desc(capturedAtExpr), desc(assets.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);

  return {
    assets: pageRows.map((row) => {
      const capturedAt =
        row.capturedAtOverride ?? row.capturedAtOriginal ?? row.createdAt;
      return {
        id: row.id,
        displayName: row.displayName,
        assetType: row.assetType,
        sequenceKind: row.sequenceKind,
        capturedAt: capturedAt ? capturedAt.toISOString() : null,
        panoramaBadge: panoramaViewerBadgeLabel({
          assetType: row.assetType,
          sequenceKind: row.sequenceKind,
          mediaMetadata: row.mediaMetadata as MediaMetadata | null,
        }),
      };
    }),
    nextCursor: hasMore && last ? encodeDroneAssetCursor(last) : null,
  };
}

export async function getDroneForUser(userId: string, droneId: string) {
  const list = await listDronesForUser(userId);
  return list.find((drone) => drone.id === droneId) ?? null;
}

export async function createDrone(
  userId: string,
  input: { name: string; model?: string; serialNumber?: string },
) {
  const db = getWebDb();
  const [row] = await db
    .insert(drones)
    .values({
      userId,
      name: input.name,
      model: input.model ?? null,
      serialNumber: input.serialNumber ?? null,
    })
    .returning();

  return row;
}

export async function updateDrone(
  userId: string,
  droneId: string,
  input: { name?: string; model?: string | null; serialNumber?: string | null },
) {
  const db = getWebDb();
  const [row] = await db
    .update(drones)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(drones.id, droneId), eq(drones.userId, userId)))
    .returning();

  return row ?? null;
}

export async function deleteDrone(userId: string, droneId: string) {
  const db = getWebDb();
  const [row] = await db
    .delete(drones)
    .where(and(eq(drones.id, droneId), eq(drones.userId, userId)))
    .returning({ id: drones.id });

  return row ?? null;
}

export { getCompiledStatsForDrone };
