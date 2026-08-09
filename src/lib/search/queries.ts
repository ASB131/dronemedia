import {
  and,
  desc,
  eq,
  ilike,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { getEffectiveCaptureDate } from "@/lib/assets/capture";
import {
  assetSearchQuery,
  effectiveCapturedAt,
  withinBbox,
} from "@/lib/db/query-helpers";
import { getWebDb } from "@/lib/db";
import { assets, drones, flights } from "@/lib/db/schema";
import { forwardGeocode } from "@/lib/geo/forward-geocode";

export type SearchFilters = {
  q?: string;
  limit?: number;
  cursor?: string;
};

export type SearchAssetResult = {
  type: "asset";
  id: string;
  displayName: string;
  assetType: "photo" | "video" | "sequence";
  capturedAt: string;
  aspectRatio: number;
};

export type SearchFlightResult = {
  type: "flight";
  id: string;
  title: string | null;
  startTime: string | null;
};

export type SearchResults = {
  assets: SearchAssetResult[];
  flights: SearchFlightResult[];
  nextCursor: string | null;
};

type AssetCursor = {
  updatedAt: string;
  id: string;
};

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

function decodeAssetCursor(cursor: string): AssetCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<AssetCursor>;
    const updatedAt = new Date(parsed.updatedAt ?? "");

    if (
      typeof parsed.id !== "string" ||
      Number.isNaN(updatedAt.getTime())
    ) {
      throw new Error("Invalid asset search cursor");
    }

    return { id: parsed.id, updatedAt: updatedAt.toISOString() };
  } catch {
    throw new Error("Invalid asset search cursor");
  }
}

function encodeAssetCursor(cursor: AssetCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function dateMatchCondition(query: string): SQL | null {
  const trimmed = query.trim();
  const yearOnly = /^(\d{4})$/.exec(trimmed);
  if (yearOnly) {
    return sql`extract(year from ${effectiveCapturedAt()}) = ${Number(yearOnly[1])}`;
  }

  const yearMonth = /^(\d{4})-(\d{1,2})$/.exec(trimmed);
  if (yearMonth) {
    const year = Number(yearMonth[1]);
    const month = Number(yearMonth[2]);
    if (month >= 1 && month <= 12) {
      return and(
        sql`extract(year from ${effectiveCapturedAt()}) = ${year}`,
        sql`extract(month from ${effectiveCapturedAt()}) = ${month}`,
      )!;
    }
  }

  const isoDate = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]);
    const day = Number(isoDate[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return and(
        sql`extract(year from ${effectiveCapturedAt()}) = ${year}`,
        sql`extract(month from ${effectiveCapturedAt()}) = ${month}`,
        sql`extract(day from ${effectiveCapturedAt()}) = ${day}`,
      )!;
    }
  }

  const month = MONTHS[trimmed.toLowerCase()];
  if (month) {
    return sql`extract(month from ${effectiveCapturedAt()}) = ${month}`;
  }

  return null;
}

function looksLikePlaceQuery(query: string) {
  if (query.length < 3) return false;
  if (/^\d{4}(-\d{1,2}(-\d{1,2})?)?$/.test(query)) return false;
  if (MONTHS[query.toLowerCase()]) return false;
  // Skip pure serial/filename-ish tokens with no letters that form words
  if (/^[a-z]*\d+[a-z\d._-]*$/i.test(query) && /\d/.test(query)) return false;
  return /[a-z]/i.test(query);
}

function aspectRatioFromMetadata(
  metadata: { width?: number | null; height?: number | null } | null,
): number {
  const width = metadata?.width;
  const height = metadata?.height;
  if (
    typeof width === "number" &&
    typeof height === "number" &&
    width > 0 &&
    height > 0
  ) {
    return width / height;
  }
  return 16 / 9;
}

export async function searchForUser(
  userId: string,
  filters: SearchFilters,
): Promise<SearchResults> {
  const limit = Math.min(Math.max(filters.limit ?? 48, 1), 100);
  const trimmed = filters.q?.trim() ?? "";

  if (!trimmed) {
    return { assets: [], flights: [], nextCursor: null };
  }

  const db = getWebDb();
  const pattern = `%${escapeLike(trimmed)}%`;
  const matchClauses: SQL[] = [
    assetSearchQuery(trimmed),
    ilike(assets.displayName, pattern),
    ilike(assets.description, pattern),
    sql`exists (
      select 1
      from unnest(${assets.tags}) as tag
      where tag ilike ${pattern}
    )`,
    sql`exists (
      select 1
      from ${drones}
      where ${drones.id} = ${assets.droneId}
        and ${drones.userId} = ${userId}
        and (
          ${drones.name} ilike ${pattern}
          or ${drones.model} ilike ${pattern}
          or ${drones.serialNumber} ilike ${pattern}
        )
    )`,
    sql`exists (
      select 1
      from ${flights}
      where ${flights.id} = ${assets.flightId}
        and ${flights.userId} = ${userId}
        and ${flights.title} ilike ${pattern}
    )`,
  ];

  const dateMatch = dateMatchCondition(trimmed);
  if (dateMatch) matchClauses.push(dateMatch);

  if (looksLikePlaceQuery(trimmed)) {
    const place = await forwardGeocode(trimmed);
    if (place) {
      matchClauses.push(
        withinBbox(place.minLat, place.minLng, place.maxLat, place.maxLng),
      );
    }
  }

  const conditions: SQL[] = [
    eq(assets.userId, userId),
    isNull(assets.deletedAt),
    or(...matchClauses)!,
  ];

  if (filters.cursor) {
    const cursor = decodeAssetCursor(filters.cursor);
    const cursorUpdatedAt = new Date(cursor.updatedAt);
    conditions.push(
      or(
        sql`${assets.updatedAt} < ${cursorUpdatedAt}`,
        and(
          eq(assets.updatedAt, cursorUpdatedAt),
          sql`${assets.id} < ${cursor.id}`,
        ),
      )!,
    );
  }

  const assetRows = await db
    .select({
      id: assets.id,
      displayName: assets.displayName,
      assetType: assets.assetType,
      mediaMetadata: assets.mediaMetadata,
      capturedAtOriginal: assets.capturedAtOriginal,
      capturedAtOverride: assets.capturedAtOverride,
      createdAt: assets.createdAt,
      updatedAt: assets.updatedAt,
    })
    .from(assets)
    .where(and(...conditions))
    .orderBy(desc(assets.updatedAt), desc(assets.id))
    .limit(limit + 1);

  const hasNextPage = assetRows.length > limit;
  const pageAssetRows = assetRows.slice(0, limit);
  const lastAsset = pageAssetRows.at(-1);

  const flightRows = filters.cursor
    ? []
    : await db
        .select({
          id: flights.id,
          title: flights.title,
          startTime: flights.startTime,
        })
        .from(flights)
        .where(
          and(
            eq(flights.userId, userId),
            or(
              ilike(flights.title, pattern),
              sql`exists (
                select 1
                from ${drones}
                where ${drones.id} = ${flights.droneId}
                  and ${drones.userId} = ${userId}
                  and ${drones.name} ilike ${pattern}
              )`,
            ),
          ),
        )
        .orderBy(desc(flights.startTime))
        .limit(Math.min(limit, 12));

  return {
    assets: pageAssetRows.map((row) => ({
      type: "asset" as const,
      id: row.id,
      displayName: row.displayName,
      assetType: row.assetType,
      capturedAt: getEffectiveCaptureDate(row).toISOString(),
      aspectRatio: aspectRatioFromMetadata(row.mediaMetadata),
    })),
    flights: flightRows.map((row) => ({
      type: "flight" as const,
      id: row.id,
      title: row.title,
      startTime: row.startTime?.toISOString() ?? null,
    })),
    nextCursor:
      hasNextPage && lastAsset
        ? encodeAssetCursor({
            id: lastAsset.id,
            updatedAt: lastAsset.updatedAt.toISOString(),
          })
        : null,
  };
}
