import { and, eq, isNull, sql } from "drizzle-orm";

import type { MediaMetadata } from "@/lib/assets/media-metadata";
import { getWebDb } from "@/lib/db";
import { withinBbox } from "@/lib/db/query-helpers";
import { assets, flightTelemetry } from "@/lib/db/schema";

export type MapAssetDto = {
  id: string;
  displayName: string;
  assetType: "photo" | "video" | "sequence";
  sequenceKind: "hyperlapse" | "panorama" | null;
  frameCount: number | null;
  lat: number;
  lng: number;
  hasHls: boolean;
  hasProxy: boolean;
  hasLrf: boolean;
  mediaMetadata: MediaMetadata | null;
  preferredLutId: string | null;
};

export type MapFlightPathDto = {
  assetId: string;
  displayName: string;
  coordinates: Array<[number, number]>;
};

export async function listMapAssetsForUser(
  userId: string,
  options?: {
    assetType?: "photo" | "video" | "sequence";
    north?: number;
    south?: number;
    east?: number;
    west?: number;
    limit?: number;
  },
): Promise<MapAssetDto[]> {
  const db = getWebDb();
  const conditions = [
    eq(assets.userId, userId),
    isNull(assets.deletedAt),
    sql`coalesce(${assets.locationOverride}, ${assets.locationOriginal}) is not null`,
  ];
  if (options?.assetType) {
    conditions.push(eq(assets.assetType, options.assetType));
  }
  if (
    options?.north != null &&
    options?.south != null &&
    options?.east != null &&
    options?.west != null
  ) {
    conditions.push(
      withinBbox(
        options.south,
        options.west,
        options.north,
        options.east,
      ),
    );
  }

  const rows = await db
    .select({
      id: assets.id,
      displayName: assets.displayName,
      assetType: assets.assetType,
      sequenceKind: assets.sequenceKind,
      frameCount: assets.frameCount,
      hasLrf: assets.hasLrf,
      hasProxy: assets.hasProxy,
      hasHls: assets.hasHls,
      mediaMetadata: assets.mediaMetadata,
      preferredLutId: assets.preferredLutId,
      lat: sql<number>`ST_Y(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
      lng: sql<number>`ST_X(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
    })
    .from(assets)
    .where(and(...conditions))
    .limit(options?.limit ?? 2000);

  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    assetType: row.assetType,
    sequenceKind: row.sequenceKind ?? null,
    frameCount: row.frameCount ?? null,
    lat: row.lat,
    lng: row.lng,
    hasHls: row.hasHls,
    hasProxy: row.hasProxy || row.hasLrf,
    hasLrf: row.hasLrf,
    mediaMetadata: row.mediaMetadata ?? null,
    preferredLutId: row.preferredLutId ?? null,
  }));
}

export async function listMapFlightPathsForUser(
  userId: string,
): Promise<MapFlightPathDto[]> {
  const db = getWebDb();
  const rows = await db
    .select({
      assetId: assets.id,
      displayName: assets.displayName,
      pathJson: sql<string | null>`ST_AsGeoJSON(${flightTelemetry.flightPath})`,
    })
    .from(flightTelemetry)
    .innerJoin(assets, eq(assets.id, flightTelemetry.assetId))
    .where(
      and(
        eq(assets.userId, userId),
        isNull(assets.deletedAt),
        sql`${flightTelemetry.flightPath} is not null`,
      ),
    )
    .limit(200);

  return rows
    .map((row) => {
      if (!row.pathJson) return null;
      const geo = JSON.parse(row.pathJson) as {
        type: string;
        coordinates: Array<[number, number]>;
      };
      if (!geo.coordinates?.length) return null;
      return {
        assetId: row.assetId,
        displayName: row.displayName,
        coordinates: geo.coordinates,
      };
    })
    .filter((row): row is MapFlightPathDto => Boolean(row));
}
