import { and, eq, isNull } from "drizzle-orm";

import { getWebDb } from "@/lib/db";
import { albumAssets, albumMembers, assets } from "@/lib/db/schema";

export type AccessibleAsset = typeof assets.$inferSelect & {
  accessRole: "owner" | "editor" | "viewer";
};

export async function getOwnedAsset(
  userId: string,
  assetId: string,
): Promise<typeof assets.$inferSelect | null> {
  const db = getWebDb();
  const [asset] = await db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.id, assetId),
        eq(assets.userId, userId),
        isNull(assets.deletedAt),
      ),
    )
    .limit(1);
  return asset ?? null;
}

/** Owner or album collaborator (viewer/editor) can read the asset. */
export async function getAccessibleAsset(
  userId: string,
  assetId: string,
): Promise<AccessibleAsset | null> {
  const owned = await getOwnedAsset(userId, assetId);
  if (owned) {
    return { ...owned, accessRole: "owner" };
  }

  const db = getWebDb();
  const [row] = await db
    .select({
      asset: assets,
      role: albumMembers.role,
    })
    .from(assets)
    .innerJoin(albumAssets, eq(albumAssets.assetId, assets.id))
    .innerJoin(
      albumMembers,
      and(
        eq(albumMembers.albumId, albumAssets.albumId),
        eq(albumMembers.userId, userId),
      ),
    )
    .where(and(eq(assets.id, assetId), isNull(assets.deletedAt)))
    .limit(1);

  if (!row) return null;

  return { ...row.asset, accessRole: row.role };
}
