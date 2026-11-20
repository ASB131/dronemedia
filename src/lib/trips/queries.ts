import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { ApiError } from "@/lib/api/auth";
import { getWebDb } from "@/lib/db";
import { assets, trips } from "@/lib/db/schema";
import type { TripDetailDto, TripSummaryDto } from "@/lib/trips/types";

export type { TripDetailDto, TripSummaryDto } from "@/lib/trips/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseTripDate(value: string, field: string): string {
  const trimmed = value.trim();
  if (!ISO_DATE.test(trimmed)) {
    throw new ApiError(400, `${field} must be YYYY-MM-DD`);
  }
  const d = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== trimmed) {
    throw new ApiError(400, `Invalid ${field}`);
  }
  return trimmed;
}

function assertTripDateOrder(startDate: string, endDate: string) {
  if (endDate < startDate) {
    throw new ApiError(400, "End date must be on or after start date");
  }
}

/** Coalesce capture time for range filters (matches timeline). */
export function tripCaptureDateSql() {
  return sql`date_trunc('milliseconds', coalesce(${assets.capturedAtOverride}, ${assets.capturedAtOriginal}, ${assets.createdAt}))`;
}

export function tripDateRangeCondition(startDate: string, endDate: string) {
  const captured = tripCaptureDateSql();
  return and(
    sql`(${captured})::date >= ${startDate}::date`,
    sql`(${captured})::date <= ${endDate}::date`,
  );
}

async function coverAssetIdForRange(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<string | null> {
  const db = getWebDb();
  const captured = tripCaptureDateSql();
  const [row] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.userId, userId),
        isNull(assets.deletedAt),
        tripDateRangeCondition(startDate, endDate),
      ),
    )
    .orderBy(desc(captured), desc(assets.id))
    .limit(1);
  return row?.id ?? null;
}

async function assetCountForRange(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<number> {
  const db = getWebDb();
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(assets)
    .where(
      and(
        eq(assets.userId, userId),
        isNull(assets.deletedAt),
        tripDateRangeCondition(startDate, endDate),
      ),
    );
  return row?.count ?? 0;
}

export async function listTripsForUser(userId: string): Promise<TripSummaryDto[]> {
  const db = getWebDb();
  const rows = await db
    .select({
      id: trips.id,
      name: trips.name,
      startDate: trips.startDate,
      endDate: trips.endDate,
      createdAt: trips.createdAt,
    })
    .from(trips)
    .where(eq(trips.userId, userId))
    .orderBy(desc(trips.startDate), desc(trips.createdAt));

  const results: TripSummaryDto[] = [];
  for (const row of rows) {
    const [assetCount, coverAssetId] = await Promise.all([
      assetCountForRange(userId, row.startDate, row.endDate),
      coverAssetIdForRange(userId, row.startDate, row.endDate),
    ]);
    results.push({
      id: row.id,
      name: row.name,
      startDate: row.startDate,
      endDate: row.endDate,
      assetCount,
      coverAssetId,
      createdAt: row.createdAt.toISOString(),
    });
  }
  return results;
}

export async function getTripForUser(
  userId: string,
  tripId: string,
): Promise<TripDetailDto | null> {
  const db = getWebDb();
  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.userId, userId)))
    .limit(1);
  if (!trip) return null;

  const range = tripDateRangeCondition(trip.startDate, trip.endDate);
  const base = and(eq(assets.userId, userId), isNull(assets.deletedAt), range);

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      photos: sql<number>`count(*) filter (where ${assets.assetType} = 'photo')::int`,
      videos: sql<number>`count(*) filter (where ${assets.assetType} in ('video', 'sequence') and coalesce(${assets.sequenceKind}, '') != 'panorama')::int`,
      panoramas: sql<number>`count(*) filter (where ${assets.sequenceKind} = 'panorama')::int`,
      located: sql<number>`count(*) filter (where coalesce(${assets.locationOverride}, ${assets.locationOriginal}) is not null)::int`,
    })
    .from(assets)
    .where(base);

  const coverAssetId = await coverAssetIdForRange(
    userId,
    trip.startDate,
    trip.endDate,
  );

  return {
    id: trip.id,
    name: trip.name,
    startDate: trip.startDate,
    endDate: trip.endDate,
    assetCount: counts?.total ?? 0,
    coverAssetId,
    createdAt: trip.createdAt.toISOString(),
    photoCount: counts?.photos ?? 0,
    videoCount: counts?.videos ?? 0,
    panoramaCount: counts?.panoramas ?? 0,
    locatedCount: counts?.located ?? 0,
  };
}

export async function createTrip(
  userId: string,
  input: { name: string; startDate: string; endDate: string },
) {
  const name = input.name.trim();
  if (!name) throw new ApiError(400, "Trip name is required");
  if (name.length > 120) throw new ApiError(400, "Trip name is too long");
  const startDate = parseTripDate(input.startDate, "Start date");
  const endDate = parseTripDate(input.endDate, "End date");
  assertTripDateOrder(startDate, endDate);

  const db = getWebDb();
  const [row] = await db
    .insert(trips)
    .values({
      userId,
      name,
      startDate,
      endDate,
    })
    .returning({ id: trips.id });

  return row!.id;
}

export async function updateTrip(
  userId: string,
  tripId: string,
  input: { name?: string; startDate?: string; endDate?: string },
) {
  const db = getWebDb();
  const [existing] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.userId, userId)))
    .limit(1);
  if (!existing) return null;

  const name = input.name !== undefined ? input.name.trim() : existing.name;
  if (!name) throw new ApiError(400, "Trip name is required");
  if (name.length > 120) throw new ApiError(400, "Trip name is too long");
  const startDate =
    input.startDate !== undefined
      ? parseTripDate(input.startDate, "Start date")
      : existing.startDate;
  const endDate =
    input.endDate !== undefined
      ? parseTripDate(input.endDate, "End date")
      : existing.endDate;
  assertTripDateOrder(startDate, endDate);

  await db
    .update(trips)
    .set({
      name,
      startDate,
      endDate,
      updatedAt: new Date(),
    })
    .where(eq(trips.id, tripId));

  return tripId;
}

export async function deleteTrip(userId: string, tripId: string) {
  const db = getWebDb();
  const [existing] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.userId, userId)))
    .limit(1);
  if (!existing) return false;
  await db.delete(trips).where(eq(trips.id, tripId));
  return true;
}

/** Resolve trip dates for timeline/map APIs. */
export async function requireTripDates(
  userId: string,
  tripId: string,
): Promise<{ startDate: string; endDate: string }> {
  const db = getWebDb();
  const [trip] = await db
    .select({
      startDate: trips.startDate,
      endDate: trips.endDate,
    })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.userId, userId)))
    .limit(1);
  if (!trip) throw new ApiError(404, "Trip not found");
  return { startDate: trip.startDate, endDate: trip.endDate };
}
