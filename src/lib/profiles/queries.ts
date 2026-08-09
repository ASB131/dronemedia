import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { getEffectiveCaptureDate } from "@/lib/assets/capture";
import type { MediaMetadata } from "@/lib/assets/media-metadata";
import { getWebDb } from "@/lib/db";
import { assets, users } from "@/lib/db/schema";
import type { MapAssetDto } from "@/lib/map/queries";
import { fuzzMediaPoint } from "@/lib/shares/privacy";

export type PublicProfileDto = {
  username: string;
  displayName: string;
  bio: string | null;
  publicAssetCount: number;
  memberSince: string;
};

export type PublicPlaybackFlags = {
  hasHls: boolean;
  hasProxy: boolean;
  hasLrf: boolean;
};

export type PublicPortfolioAssetDto = {
  id: string;
  displayName: string;
  assetType: "photo" | "video" | "sequence";
  capturedAt: string;
  mainFileExt: string;
  description: string | null;
  fileSizeBytes: number | null;
  hasSrt: boolean;
  mediaMetadata: MediaMetadata | null;
  preferredLutId: string | null;
  location: { lat: number; lng: number } | null;
} & PublicPlaybackFlags;

export type CommunityUserDto = {
  username: string;
  displayName: string;
  bio: string | null;
  publicAssetCount: number;
  coverAssetId: string | null;
};

export async function getApprovedUserByUsername(username: string) {
  const db = getWebDb();
  const normalized = username.trim().toLowerCase();
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      bio: users.bio,
      createdAt: users.createdAt,
      approvalStatus: users.approvalStatus,
    })
    .from(users)
    .where(sql`lower(${users.username}) = ${normalized}`)
    .limit(1);

  if (!row || row.approvalStatus !== "approved") return null;
  return row;
}

export async function getPublicProfile(
  username: string,
): Promise<PublicProfileDto | null> {
  const user = await getApprovedUserByUsername(username);
  if (!user) return null;

  const db = getWebDb();
  const [countRow] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(assets)
    .where(
      and(
        eq(assets.userId, user.id),
        eq(assets.isPublic, true),
        isNull(assets.deletedAt),
      ),
    );

  return {
    username: user.username,
    displayName: user.displayName?.trim() || user.username,
    bio: user.bio,
    publicAssetCount: countRow?.count ?? 0,
    memberSince: user.createdAt.toISOString(),
  };
}

function playbackFromRow(row: {
  hasHls: boolean;
  hasProxy: boolean;
  hasLrf: boolean;
}): PublicPlaybackFlags {
  return {
    hasHls: row.hasHls,
    hasProxy: row.hasProxy || row.hasLrf,
    hasLrf: row.hasLrf,
  };
}

export async function listPublicPortfolioAssets(
  username: string,
  limit = 200,
): Promise<PublicPortfolioAssetDto[]> {
  const user = await getApprovedUserByUsername(username);
  if (!user) return [];

  const db = getWebDb();
  const rows = await db
    .select({
      id: assets.id,
      displayName: assets.displayName,
      assetType: assets.assetType,
      mainFileExt: assets.mainFileExt,
      description: assets.description,
      fileSizeBytes: assets.fileSizeBytes,
      hasSrt: assets.hasSrt,
      hasLrf: assets.hasLrf,
      hasProxy: assets.hasProxy,
      hasHls: assets.hasHls,
      mediaMetadata: assets.mediaMetadata,
      preferredLutId: assets.preferredLutId,
      lat: sql<number | null>`ST_Y(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
      lng: sql<number | null>`ST_X(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
      capturedAtOriginal: assets.capturedAtOriginal,
      capturedAtOverride: assets.capturedAtOverride,
      createdAt: assets.createdAt,
    })
    .from(assets)
    .where(
      and(
        eq(assets.userId, user.id),
        eq(assets.isPublic, true),
        isNull(assets.deletedAt),
      ),
    )
    .orderBy(
      desc(
        sql`coalesce(${assets.capturedAtOverride}, ${assets.capturedAtOriginal}, ${assets.createdAt})`,
      ),
    )
    .limit(limit);

  return rows.map((row) => {
    const hasCoords =
      typeof row.lat === "number" &&
      typeof row.lng === "number" &&
      Number.isFinite(row.lat) &&
      Number.isFinite(row.lng);
    const fuzzed = hasCoords
      ? fuzzMediaPoint([row.lng!, row.lat!])
      : null;
    return {
      id: row.id,
      displayName: row.displayName,
      assetType: row.assetType,
      mainFileExt: row.mainFileExt,
      description: row.description,
      fileSizeBytes: row.fileSizeBytes,
      hasSrt: row.hasSrt,
      mediaMetadata: row.mediaMetadata ?? null,
      preferredLutId: row.preferredLutId ?? null,
      location: fuzzed
        ? { lat: fuzzed[1], lng: fuzzed[0] }
        : null,
      capturedAt: getEffectiveCaptureDate(row).toISOString(),
      ...playbackFromRow(row),
    };
  });
}

export async function listPublicMapAssetsForUsername(
  username: string,
): Promise<MapAssetDto[]> {
  const user = await getApprovedUserByUsername(username);
  if (!user) return [];

  const db = getWebDb();
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
    .where(
      and(
        eq(assets.userId, user.id),
        eq(assets.isPublic, true),
        isNull(assets.deletedAt),
        sql`coalesce(${assets.locationOverride}, ${assets.locationOriginal}) is not null`,
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    assetType: row.assetType,
    sequenceKind: row.sequenceKind ?? null,
    frameCount: row.frameCount ?? null,
    lat: row.lat,
    lng: row.lng,
    ...playbackFromRow(row),
    mediaMetadata: row.mediaMetadata ?? null,
    preferredLutId: row.preferredLutId ?? null,
  }));
}

export async function getPublicAssetForUsername(
  username: string,
  assetId: string,
) {
  const user = await getApprovedUserByUsername(username);
  if (!user) return null;

  const db = getWebDb();
  const [row] = await db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.id, assetId),
        eq(assets.userId, user.id),
        eq(assets.isPublic, true),
        isNull(assets.deletedAt),
      ),
    )
    .limit(1);

  return row ?? null;
}

export type CommunityMapAssetDto = MapAssetDto &
  PublicPlaybackFlags & {
    username: string;
    ownerDisplayName: string;
  };

export async function listCommunityMapAssets(
  limit = 500,
): Promise<CommunityMapAssetDto[]> {
  const db = getWebDb();
  const rows = await db
    .select({
      id: assets.id,
      userId: assets.userId,
      displayName: assets.displayName,
      assetType: assets.assetType,
      sequenceKind: assets.sequenceKind,
      frameCount: assets.frameCount,
      hasLrf: assets.hasLrf,
      hasProxy: assets.hasProxy,
      hasHls: assets.hasHls,
      mediaMetadata: assets.mediaMetadata,
      preferredLutId: assets.preferredLutId,
      username: users.username,
      ownerDisplayName: users.displayName,
      lat: sql<number>`ST_Y(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
      lng: sql<number>`ST_X(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
    })
    .from(assets)
    .innerJoin(users, eq(users.id, assets.userId))
    .where(
      and(
        eq(assets.isPublic, true),
        isNull(assets.deletedAt),
        eq(users.approvalStatus, "approved"),
        sql`coalesce(${assets.locationOverride}, ${assets.locationOriginal}) is not null`,
      ),
    )
    .orderBy(
      desc(
        sql`coalesce(${assets.capturedAtOverride}, ${assets.capturedAtOriginal}, ${assets.createdAt})`,
      ),
    )
    .limit(limit);

  return rows.map((row) => {
    const [lng, lat] = fuzzMediaPoint([row.lng, row.lat]);
    return {
      id: row.id,
      displayName: row.displayName,
      assetType: row.assetType,
      sequenceKind: row.sequenceKind ?? null,
      frameCount: row.frameCount ?? null,
      lat,
      lng,
      username: row.username,
      ownerDisplayName: row.ownerDisplayName?.trim() || row.username,
      mediaMetadata: row.mediaMetadata ?? null,
      preferredLutId: row.preferredLutId ?? null,
      ...playbackFromRow(row),
    };
  });
}

export async function listCommunityProfiles(
  limit = 60,
): Promise<CommunityUserDto[]> {
  const db = getWebDb();
  const rows = await db
    .select({
      username: users.username,
      displayName: users.displayName,
      bio: users.bio,
      publicAssetCount: sql<number>`count(${assets.id})::int`,
      coverAssetId: sql<string | null>`(
        select a.id
        from assets a
        where a.user_id = ${users.id}
          and a.is_public = true
          and a.deleted_at is null
        order by
          case
            when a.id::text = (${users.preferences} -> 'portfolio' ->> 'coverAssetId')
            then 0 else 1
          end,
          coalesce(a.captured_at_override, a.captured_at_original, a.created_at) desc nulls last
        limit 1
      )`,
    })
    .from(users)
    .innerJoin(
      assets,
      and(
        eq(assets.userId, users.id),
        eq(assets.isPublic, true),
        isNull(assets.deletedAt),
      ),
    )
    .where(eq(users.approvalStatus, "approved"))
    .groupBy(users.id)
    .orderBy(desc(sql`count(${assets.id})`))
    .limit(limit);

  return rows.map((row) => ({
    username: row.username,
    displayName: row.displayName?.trim() || row.username,
    bio: row.bio,
    publicAssetCount: row.publicAssetCount,
    coverAssetId: row.coverAssetId,
  }));
}

export async function updateUserProfile(
  userId: string,
  input: { displayName?: string | null; bio?: string | null },
) {
  const db = getWebDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.displayName !== undefined) {
    set.displayName = input.displayName?.trim() || null;
  }
  if (input.bio !== undefined) {
    set.bio = input.bio?.trim() || null;
  }

  const [row] = await db
    .update(users)
    .set(set)
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      bio: users.bio,
    });

  return row ?? null;
}
