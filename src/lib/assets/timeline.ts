import { and, desc, eq, isNull, ne, or, sql, type SQL } from "drizzle-orm";

import { getWebDb } from "@/lib/db";
import { assets, flightTelemetry } from "@/lib/db/schema";
import type { AssetType } from "@/lib/assets/asset-type";
import type { MediaMetadata } from "./media-metadata";
import { panoramaViewerBadgeLabel } from "./panorama-viewer-mode";
import {
  getCaptureLocalParts,
  getCaptureTimezone,
  getEffectiveCaptureDate,
} from "./capture";

export type TimelineMediaTypeFilter = "all" | "photo" | "video" | "panorama";

export type TimelineAssetDto = {
  id: string;
  displayName: string;
  assetType: AssetType;
  favorite: boolean;
  isPublic: boolean;
  capturedAt: string;
  capturedTimezone: string;
  hasThumbnail: boolean;
  mainFileExt: string;
  hasSrt: boolean;
  frameCount?: number | null;
  sequenceKind?: "hyperlapse" | "panorama" | null;
  /** 180° / 360° badge when this asset is shown as an equirect. */
  panoramaBadge?: string | null;
  /** Width / height from media metadata; defaults to 16/9 for drone footage. */
  aspectRatio: number;
  location: { lat: number; lng: number } | null;
  hasFlightPath: boolean;
  updatedAt: string;
};

function aspectRatioFromMetadata(
  metadata: MediaMetadata | null | undefined,
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

export type TimelineSectionDto = {
  key: string;
  year: number;
  month: number;
  day: number;
  monthLabel: string;
  dateLabel: string;
  assets: TimelineAssetDto[];
};

/** Media from this calendar day in prior years, grouped newest year first. */
export type OnThisDayGroupDto = {
  year: number;
  yearsAgo: number;
  label: string;
  assets: TimelineAssetDto[];
};

export type TimelineResponse = {
  sections: TimelineSectionDto[];
  onThisDay: OnThisDayGroupDto[];
  nextCursor: string | null;
};

export type TimelineCursor = {
  capturedAt: Date;
  id: string;
};

export function decodeTimelineCursor(cursor: string): TimelineCursor {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("capturedAt" in parsed) ||
      !("id" in parsed) ||
      typeof parsed.capturedAt !== "string" ||
      typeof parsed.id !== "string"
    ) {
      throw new Error("Invalid timeline cursor");
    }

    const capturedAt = new Date(parsed.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) {
      throw new Error("Invalid timeline cursor");
    }

    return { capturedAt, id: parsed.id };
  } catch {
    throw new Error("Invalid timeline cursor");
  }
}

function encodeTimelineCursor(row: {
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

function toTimelineAssetDto(row: {
  id: string;
  displayName: string;
  assetType: AssetType;
  favorite: boolean;
  isPublic: boolean;
  mainFileExt: string;
  hasSrt: boolean;
  frameCount: number | null;
  sequenceKind: "hyperlapse" | "panorama" | null;
  mediaMetadata: MediaMetadata | null;
  capturedTimezone: string | null;
  capturedAtOriginal: Date | null;
  capturedAtOverride: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lat: number | null;
  lng: number | null;
  hasFlightPath: boolean;
}): TimelineAssetDto {
  const capturedAt = getEffectiveCaptureDate(row);
  const tz = getCaptureTimezone(row);
  const hasCoords =
    row.lat != null &&
    row.lng != null &&
    Number.isFinite(row.lat) &&
    Number.isFinite(row.lng);
  return {
    id: row.id,
    displayName: row.displayName,
    assetType: row.assetType,
    favorite: row.favorite,
    isPublic: row.isPublic,
    capturedAt: capturedAt.toISOString(),
    capturedTimezone: tz,
    hasThumbnail: true,
    mainFileExt: row.mainFileExt,
    hasSrt: row.hasSrt,
    frameCount: row.frameCount,
    sequenceKind: row.sequenceKind,
    panoramaBadge: panoramaViewerBadgeLabel({
      assetType: row.assetType,
      sequenceKind: row.sequenceKind,
      mediaMetadata: row.mediaMetadata,
    }),
    aspectRatio: aspectRatioFromMetadata(row.mediaMetadata),
    location: hasCoords ? { lat: row.lat!, lng: row.lng! } : null,
    hasFlightPath: Boolean(row.hasFlightPath),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mediaTypeCondition(mediaType: TimelineMediaTypeFilter): SQL | null {
  if (mediaType === "photo") {
    return eq(assets.assetType, "photo");
  }
  if (mediaType === "video") {
    return or(
      eq(assets.assetType, "video"),
      and(
        eq(assets.assetType, "sequence"),
        or(isNull(assets.sequenceKind), ne(assets.sequenceKind, "panorama")),
      ),
    )!;
  }
  if (mediaType === "panorama") {
    return eq(assets.sequenceKind, "panorama");
  }
  return null;
}

const timelineAssetSelect = {
  id: assets.id,
  displayName: assets.displayName,
  assetType: assets.assetType,
  favorite: assets.favorite,
  isPublic: assets.isPublic,
  mainFileExt: assets.mainFileExt,
  hasSrt: assets.hasSrt,
  frameCount: assets.frameCount,
  sequenceKind: assets.sequenceKind,
  mediaMetadata: assets.mediaMetadata,
  capturedTimezone: assets.capturedTimezone,
  capturedAtOriginal: assets.capturedAtOriginal,
  capturedAtOverride: assets.capturedAtOverride,
  createdAt: assets.createdAt,
  updatedAt: assets.updatedAt,
  lat: sql<number | null>`ST_Y(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
  lng: sql<number | null>`ST_X(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
  hasFlightPath: sql<boolean>`${flightTelemetry.flightPath} is not null`,
};

async function listOnThisDayGroups(
  userId: string,
  favoritesOnly: boolean,
  mediaType: TimelineMediaTypeFilter = "all",
): Promise<OnThisDayGroupDto[]> {
  const db = getWebDb();
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  const currentYear = now.getUTCFullYear();
  const displayCapturedAt = sql`date_trunc('milliseconds', coalesce(${assets.capturedAtOverride}, ${assets.capturedAtOriginal}, ${assets.createdAt}))`;

  const conditions: SQL[] = [
    eq(assets.userId, userId),
    isNull(assets.deletedAt),
    sql`extract(month from ${displayCapturedAt}) = ${month}`,
    sql`extract(day from ${displayCapturedAt}) = ${day}`,
    sql`extract(year from ${displayCapturedAt}) < ${currentYear}`,
  ];
  if (favoritesOnly) {
    conditions.push(eq(assets.favorite, true));
  }
  const typeCondition = mediaTypeCondition(mediaType);
  if (typeCondition) conditions.push(typeCondition);

  const rows = await db
    .select(timelineAssetSelect)
    .from(assets)
    .leftJoin(flightTelemetry, eq(flightTelemetry.assetId, assets.id))
    .where(and(...conditions))
    .orderBy(desc(displayCapturedAt), desc(assets.id))
    .limit(48);

  if (rows.length === 0) return [];

  const byYear = new Map<number, TimelineAssetDto[]>();
  for (const row of rows) {
    const asset = toTimelineAssetDto(row);
    const year = getEffectiveCaptureDate(row).getUTCFullYear();
    const list = byYear.get(year) ?? [];
    list.push(asset);
    byYear.set(year, list);
  }

  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, yearAssets]) => {
      const yearsAgo = currentYear - year;
      return {
        year,
        yearsAgo,
        label:
          yearsAgo === 1
            ? "1 year ago"
            : `${yearsAgo} years ago`,
        assets: yearAssets,
      };
    });
}

export async function getTimelineForUser(
  userId: string,
  options?: {
    favoritesOnly?: boolean;
    mediaType?: TimelineMediaTypeFilter;
    cursor?: TimelineCursor;
    limit?: number;
  },
): Promise<TimelineResponse> {
  const db = getWebDb();
  const limit = Math.min(Math.max(options?.limit ?? 80, 1), 100);
  const mediaType = options?.mediaType ?? "all";
  // Truncate to ms so keyset matches JS Date.toISOString() cursor precision.
  const displayCapturedAt = sql<Date>`date_trunc('milliseconds', coalesce(${assets.capturedAtOverride}, ${assets.capturedAtOriginal}, ${assets.createdAt}))`;
  const conditions: SQL[] = [
    eq(assets.userId, userId),
    isNull(assets.deletedAt),
  ];
  if (options?.favoritesOnly) {
    conditions.push(eq(assets.favorite, true));
  }
  const typeCondition = mediaTypeCondition(mediaType);
  if (typeCondition) conditions.push(typeCondition);
  if (options?.cursor) {
    conditions.push(sql`
      (${displayCapturedAt} < ${options.cursor.capturedAt}
      or (${displayCapturedAt} = ${options.cursor.capturedAt}
      and ${assets.id} < ${options.cursor.id}))
    `);
  }

  const rows = await db
    .select(timelineAssetSelect)
    .from(assets)
    .leftJoin(flightTelemetry, eq(flightTelemetry.assetId, assets.id))
    .where(and(...conditions))
    .orderBy(desc(displayCapturedAt), desc(assets.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const onThisDay =
    !options?.cursor
      ? await listOnThisDayGroups(
          userId,
          Boolean(options?.favoritesOnly),
          mediaType,
        )
      : [];

  const sectionMap = new Map<string, TimelineSectionDto>();

  for (const row of pageRows) {
    const capturedAt = getEffectiveCaptureDate(row);
    const tz = getCaptureTimezone(row);
    const local = getCaptureLocalParts(capturedAt, tz);
    const asset = toTimelineAssetDto(row);

    const key = `${local.year}-${local.month}-${local.day}`;
    const section = sectionMap.get(key);
    if (section) {
      section.assets.push(asset);
    } else {
      sectionMap.set(key, {
        key,
        year: local.year,
        month: local.month,
        day: local.day,
        monthLabel: local.monthLabel,
        dateLabel: local.dateLabel,
        assets: [asset],
      });
    }
  }

  const sections = [...sectionMap.values()].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    if (a.month !== b.month) return b.month - a.month;
    return b.day - a.day;
  });

  for (const section of sections) {
    section.assets.sort(
      (a, b) =>
        new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
    );
  }

  return {
    sections,
    onThisDay,
    nextCursor: hasMore
      ? encodeTimelineCursor(pageRows[pageRows.length - 1]!)
      : null,
  };
}
