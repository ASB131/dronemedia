import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getWebDb } from "@/lib/db";
import { albumAssets, albums, assets, users } from "@/lib/db/schema";
import {
  getApprovedUserByUsername,
  type PublicPortfolioAssetDto,
} from "@/lib/profiles/queries";

export type PortfolioTheme = "default" | "cinematic" | "minimal";

export type PortfolioSettings = {
  coverAssetId: string | null;
  featuredAlbumIds: string[];
  showcaseAssetIds: string[];
  theme: PortfolioTheme;
};

export type PublicFeaturedAlbumDto = {
  id: string;
  name: string;
  description: string | null;
  coverAssetId: string | null;
  publicAssetCount: number;
};

export function normalizePortfolio(
  preferences: typeof users.$inferSelect.preferences | null | undefined,
): PortfolioSettings {
  const portfolio = preferences?.portfolio;
  return {
    coverAssetId: portfolio?.coverAssetId ?? null,
    featuredAlbumIds: portfolio?.featuredAlbumIds ?? [],
    showcaseAssetIds: portfolio?.showcaseAssetIds ?? [],
    theme: portfolio?.theme ?? "default",
  };
}

export async function getPortfolioSettings(
  userId: string,
): Promise<PortfolioSettings> {
  const db = getWebDb();
  const [row] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return normalizePortfolio(row?.preferences);
}

export async function updatePortfolioSettings(
  userId: string,
  input: Partial<PortfolioSettings>,
) {
  const db = getWebDb();
  const [row] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;

  const current = normalizePortfolio(row.preferences);
  const next: PortfolioSettings = {
    coverAssetId:
      input.coverAssetId !== undefined
        ? input.coverAssetId
        : current.coverAssetId,
    featuredAlbumIds:
      input.featuredAlbumIds !== undefined
        ? input.featuredAlbumIds
        : current.featuredAlbumIds,
    showcaseAssetIds:
      input.showcaseAssetIds !== undefined
        ? input.showcaseAssetIds
        : current.showcaseAssetIds,
    theme: input.theme ?? current.theme,
  };

  await db
    .update(users)
    .set({
      preferences: {
        ...row.preferences,
        portfolio: next,
      },
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return next;
}

export async function getPublicPortfolioExtras(username: string): Promise<{
  portfolio: PortfolioSettings;
  featuredAlbums: PublicFeaturedAlbumDto[];
  showcase: PublicPortfolioAssetDto[];
  coverAssetId: string | null;
}> {
  const user = await getApprovedUserByUsername(username);
  if (!user) {
    return {
      portfolio: normalizePortfolio(null),
      featuredAlbums: [],
      showcase: [],
      coverAssetId: null,
    };
  }

  const db = getWebDb();
  const [prefs] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const portfolio = normalizePortfolio(prefs?.preferences);

  let coverAssetId = portfolio.coverAssetId;
  if (coverAssetId) {
    const [owned] = await db
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          eq(assets.id, coverAssetId),
          eq(assets.userId, user.id),
          eq(assets.isPublic, true),
          isNull(assets.deletedAt),
        ),
      )
      .limit(1);
    if (!owned) coverAssetId = null;
  }

  const featuredAlbums: PublicFeaturedAlbumDto[] = [];
  if (portfolio.featuredAlbumIds.length > 0) {
    const albumRows = await db
      .select({
        id: albums.id,
        name: albums.name,
        description: albums.description,
        publicAssetCount: sql<number>`count(${assets.id})::int`,
        coverAssetId: sql<string | null>`(
          select a.id
          from album_assets aa
          join assets a on a.id = aa.asset_id
          where aa.album_id = ${albums.id}
            and a.is_public = true
            and a.deleted_at is null
          order by coalesce(a.captured_at_override, a.captured_at_original, a.created_at) desc nulls last
          limit 1
        )`,
      })
      .from(albums)
      .leftJoin(albumAssets, eq(albumAssets.albumId, albums.id))
      .leftJoin(
        assets,
        and(
          eq(assets.id, albumAssets.assetId),
          eq(assets.isPublic, true),
          isNull(assets.deletedAt),
        ),
      )
      .where(
        and(
          eq(albums.userId, user.id),
          inArray(albums.id, portfolio.featuredAlbumIds),
        ),
      )
      .groupBy(albums.id);

    const order = new Map(
      portfolio.featuredAlbumIds.map((id, index) => [id, index]),
    );
    albumRows
      .filter((row) => row.publicAssetCount > 0)
      .sort(
        (a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999),
      )
      .forEach((row) => {
        featuredAlbums.push({
          id: row.id,
          name: row.name,
          description: row.description,
          coverAssetId: row.coverAssetId,
          publicAssetCount: row.publicAssetCount,
        });
      });
  }

  const showcase: PublicPortfolioAssetDto[] = [];
  if (portfolio.showcaseAssetIds.length > 0) {
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
          inArray(assets.id, portfolio.showcaseAssetIds),
        ),
      );

    const { getEffectiveCaptureDate } = await import("@/lib/assets/capture");
    const { fuzzMediaPoint } = await import("@/lib/shares/privacy");
    const order = new Map(
      portfolio.showcaseAssetIds.map((id, index) => [id, index]),
    );
    rows
      .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
      .forEach((row) => {
        const hasCoords =
          typeof row.lat === "number" &&
          typeof row.lng === "number" &&
          Number.isFinite(row.lat) &&
          Number.isFinite(row.lng);
        const fuzzed = hasCoords
          ? fuzzMediaPoint([row.lng!, row.lat!])
          : null;
        showcase.push({
          id: row.id,
          displayName: row.displayName,
          assetType: row.assetType,
          mainFileExt: row.mainFileExt,
          description: row.description,
          fileSizeBytes: row.fileSizeBytes,
          hasSrt: row.hasSrt,
          mediaMetadata: row.mediaMetadata ?? null,
          preferredLutId: row.preferredLutId ?? null,
          location: fuzzed ? { lat: fuzzed[1], lng: fuzzed[0] } : null,
          capturedAt: getEffectiveCaptureDate(row).toISOString(),
          hasHls: row.hasHls,
          hasProxy: row.hasProxy || row.hasLrf,
          hasLrf: row.hasLrf,
        });
      });
  }

  return {
    portfolio: { ...portfolio, coverAssetId },
    featuredAlbums,
    showcase,
    coverAssetId,
  };
}
