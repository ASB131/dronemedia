import { and, eq, isNull, sql } from "drizzle-orm";

import { getWebDb } from "@/lib/db";
import { assets, flights } from "@/lib/db/schema";
import {
  getCombinedPathsForFlightIds,
  listFlightsForUser,
} from "@/lib/flights/queries";

export type DashboardStatsDto = {
  photoCount: number;
  videoCount: number;
  panoramaCount: number;
  flightCount: number;
  totalDurationSeconds: number;
};

export type DashboardFlightPathDto = {
  flightId: string;
  title: string | null;
  coordinates: Array<[number, number]>;
};

export type DashboardPayload = {
  stats: DashboardStatsDto;
  recentFlightPaths: DashboardFlightPathDto[];
};

const RECENT_PATH_LIMIT = 10;
/** Max flights to scan when building recent paths (skip GPS-less sessions). */
const RECENT_PATH_SCAN = 40;

export async function getDashboardStats(
  userId: string,
): Promise<DashboardStatsDto> {
  const db = getWebDb();

  const [assetRow] = await db
    .select({
      photoCount: sql<number>`count(*) filter (where ${assets.assetType} = 'photo')::int`,
      videoCount: sql<number>`count(*) filter (where ${assets.assetType} = 'video')::int`,
      panoramaCount: sql<number>`count(*) filter (where ${assets.assetType} = 'sequence' and ${assets.sequenceKind} = 'panorama')::int`,
    })
    .from(assets)
    .where(and(eq(assets.userId, userId), isNull(assets.deletedAt)));

  const [flightRow] = await db
    .select({
      flightCount: sql<number>`count(*)::int`,
      totalDurationSeconds: sql<number>`coalesce(sum(${flights.totalDurationSeconds}), 0)`,
    })
    .from(flights)
    .where(
      and(
        eq(flights.userId, userId),
        sql`exists (
          select 1 from ${assets} a
          where a.flight_id = ${flights.id}
            and a.deleted_at is null
        )`,
      ),
    );

  return {
    photoCount: assetRow?.photoCount ?? 0,
    videoCount: assetRow?.videoCount ?? 0,
    panoramaCount: assetRow?.panoramaCount ?? 0,
    flightCount: flightRow?.flightCount ?? 0,
    totalDurationSeconds: Number(flightRow?.totalDurationSeconds ?? 0),
  };
}

export async function listRecentFlightPathsForUser(
  userId: string,
  limit = RECENT_PATH_LIMIT,
): Promise<DashboardFlightPathDto[]> {
  const ordered = await listFlightsForUser(userId);
  const scan = ordered.slice(0, RECENT_PATH_SCAN);
  const pathMap = await getCombinedPathsForFlightIds(
    userId,
    scan.map((flight) => flight.id),
  );

  const recentFlightPaths: DashboardFlightPathDto[] = [];
  for (const flight of scan) {
    if (recentFlightPaths.length >= limit) break;
    const coordinates = pathMap.get(flight.id);
    if (!coordinates || coordinates.length < 2) continue;
    recentFlightPaths.push({
      flightId: flight.id,
      title: flight.title,
      coordinates,
    });
  }

  return recentFlightPaths;
}

export async function getDashboardPayload(
  userId: string,
): Promise<DashboardPayload> {
  const [stats, recentFlightPaths] = await Promise.all([
    getDashboardStats(userId),
    listRecentFlightPathsForUser(userId),
  ]);
  return { stats, recentFlightPaths };
}
