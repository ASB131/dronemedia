import { and, eq, inArray, isNull } from "drizzle-orm";

import { getAlbumAccess } from "@/lib/albums/access";
import { getWebDb } from "@/lib/db";
import { albumAssets, assets } from "@/lib/db/schema";

export type CinemaSource = "all" | "favorites" | "albums";

export type CinemaPlaylistItem = {
  id: string;
  displayName: string;
  assetType: "photo" | "video" | "sequence";
  sequenceKind: "hyperlapse" | "panorama" | null;
  hasHls: boolean;
  preferredLutId: string | null;
};

export async function listCinemaPlaylist(
  userId: string,
  options: {
    source: CinemaSource;
    albumIds?: string[];
  },
): Promise<CinemaPlaylistItem[]> {
  const db = getWebDb();
  const conditions = [eq(assets.userId, userId), isNull(assets.deletedAt)];

  if (options.source === "favorites") {
    conditions.push(eq(assets.favorite, true));
  }

  if (options.source === "albums") {
    const albumIds = [...new Set(options.albumIds ?? [])].slice(0, 50);
    if (albumIds.length === 0) return [];
    const allowed: string[] = [];
    for (const albumId of albumIds) {
      const access = await getAlbumAccess(userId, albumId);
      if (access) allowed.push(albumId);
    }
    if (allowed.length === 0) return [];
    const rows = await db
      .select({ assetId: albumAssets.assetId })
      .from(albumAssets)
      .where(inArray(albumAssets.albumId, allowed));
    const albumAssetIds = [...new Set(rows.map((row) => row.assetId))];
    if (albumAssetIds.length === 0) return [];
    conditions.push(inArray(assets.id, albumAssetIds));
  }

  const rows = await db
    .select({
      id: assets.id,
      displayName: assets.displayName,
      assetType: assets.assetType,
      sequenceKind: assets.sequenceKind,
      hasHls: assets.hasHls,
      preferredLutId: assets.preferredLutId,
    })
    .from(assets)
    .where(and(...conditions))
    .limit(4000);

  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    assetType: row.assetType,
    sequenceKind: row.sequenceKind ?? null,
    hasHls: row.hasHls,
    preferredLutId: row.preferredLutId ?? null,
  }));
}
