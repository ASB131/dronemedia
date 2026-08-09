import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

import { getAlbumAccess, type AlbumAccessRole } from "@/lib/albums/access";
import { getWebDb } from "@/lib/db";
import { albumAssets, albumMembers, albums, assets, users } from "@/lib/db/schema";

export type AlbumSummaryDto = {
  id: string;
  name: string;
  description: string | null;
  assetCount: number;
  createdAt: string;
  role: AlbumAccessRole;
  ownerUsername: string;
  coverAssetId: string | null;
};

export type AlbumMemberDto = {
  userId: string;
  username: string;
  role: "editor" | "viewer";
  createdAt: string;
};

export type AlbumDetailDto = AlbumSummaryDto & {
  canEdit: boolean;
  canManageMembers: boolean;
  members: AlbumMemberDto[];
  assets: Array<{
    id: string;
    displayName: string;
    assetType: "photo" | "video" | "sequence";
    addedAt: string;
  }>;
};

export async function listAlbumsForUser(userId: string): Promise<AlbumSummaryDto[]> {
  const db = getWebDb();
  const rows = await db
    .select({
      id: albums.id,
      name: albums.name,
      description: albums.description,
      createdAt: albums.createdAt,
      ownerUserId: albums.userId,
      ownerUsername: users.username,
      assetCount: sql<number>`count(distinct ${albumAssets.assetId})::int`,
      memberRole: albumMembers.role,
      coverAssetId: sql<string | null>`(
        select aa.asset_id
        from album_assets aa
        inner join assets a on a.id = aa.asset_id
        where aa.album_id = ${albums.id}
          and a.deleted_at is null
        order by aa.added_at desc
        limit 1
      )`,
    })
    .from(albums)
    .innerJoin(users, eq(users.id, albums.userId))
    .leftJoin(albumAssets, eq(albumAssets.albumId, albums.id))
    .leftJoin(
      albumMembers,
      and(eq(albumMembers.albumId, albums.id), eq(albumMembers.userId, userId)),
    )
    .where(or(eq(albums.userId, userId), eq(albumMembers.userId, userId)))
    .groupBy(
      albums.id,
      users.username,
      albumMembers.role,
    )
    .orderBy(desc(albums.updatedAt));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    assetCount: row.assetCount,
    createdAt: row.createdAt.toISOString(),
    role: row.ownerUserId === userId ? "owner" : (row.memberRole ?? "viewer"),
    ownerUsername: row.ownerUsername,
    coverAssetId: row.coverAssetId,
  }));
}

export async function getAlbumForUser(
  userId: string,
  albumId: string,
): Promise<AlbumDetailDto | null> {
  const access = await getAlbumAccess(userId, albumId);
  if (!access) return null;

  const db = getWebDb();
  const [album] = await db
    .select({
      id: albums.id,
      name: albums.name,
      description: albums.description,
      createdAt: albums.createdAt,
      ownerUsername: users.username,
    })
    .from(albums)
    .innerJoin(users, eq(users.id, albums.userId))
    .where(eq(albums.id, albumId))
    .limit(1);

  if (!album) return null;

  const assetRows = await db
    .select({
      id: assets.id,
      displayName: assets.displayName,
      assetType: assets.assetType,
      addedAt: albumAssets.addedAt,
    })
    .from(albumAssets)
    .innerJoin(assets, eq(assets.id, albumAssets.assetId))
    .where(and(eq(albumAssets.albumId, albumId), isNull(assets.deletedAt)))
    .orderBy(desc(albumAssets.addedAt));

  const members = await listAlbumMembers(albumId);

  return {
    id: album.id,
    name: album.name,
    description: album.description,
    assetCount: assetRows.length,
    createdAt: album.createdAt.toISOString(),
    role: access.role,
    ownerUsername: album.ownerUsername,
    coverAssetId: assetRows[0]?.id ?? null,
    canEdit: access.canEdit,
    canManageMembers: access.canManageMembers,
    members,
    assets: assetRows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      assetType: row.assetType,
      addedAt: row.addedAt.toISOString(),
    })),
  };
}

export async function listAlbumMembers(albumId: string): Promise<AlbumMemberDto[]> {
  const db = getWebDb();
  const rows = await db
    .select({
      userId: albumMembers.userId,
      username: users.username,
      role: albumMembers.role,
      createdAt: albumMembers.createdAt,
    })
    .from(albumMembers)
    .innerJoin(users, eq(users.id, albumMembers.userId))
    .where(eq(albumMembers.albumId, albumId))
    .orderBy(users.username);

  return rows.map((row) => ({
    userId: row.userId,
    username: row.username,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function createAlbum(
  userId: string,
  input: { name: string; description?: string },
) {
  const db = getWebDb();
  const [row] = await db
    .insert(albums)
    .values({
      userId,
      name: input.name,
      description: input.description ?? null,
    })
    .returning();

  return row;
}

export async function updateAlbum(
  userId: string,
  albumId: string,
  input: { name?: string; description?: string | null },
) {
  const access = await getAlbumAccess(userId, albumId);
  if (!access?.canEdit) return null;

  const db = getWebDb();
  const [row] = await db
    .update(albums)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(albums.id, albumId))
    .returning();

  return row ?? null;
}

export async function deleteAlbum(userId: string, albumId: string) {
  const access = await getAlbumAccess(userId, albumId);
  if (!access || access.role !== "owner") return null;

  const db = getWebDb();
  const [row] = await db
    .delete(albums)
    .where(eq(albums.id, albumId))
    .returning({ id: albums.id });

  return row ?? null;
}

export async function addAssetToAlbum(
  userId: string,
  albumId: string,
  assetId: string,
) {
  const access = await getAlbumAccess(userId, albumId);
  if (!access?.canEdit) return null;

  const db = getWebDb();
  const [asset] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.id, assetId),
        eq(assets.userId, userId),
        isNull(assets.deletedAt),
      ),
    )
    .limit(1);

  if (!asset) return null;

  await db
    .insert(albumAssets)
    .values({ albumId, assetId })
    .onConflictDoNothing();

  return { albumId, assetId };
}

export async function removeAssetFromAlbum(
  userId: string,
  albumId: string,
  assetId: string,
) {
  const access = await getAlbumAccess(userId, albumId);
  if (!access?.canEdit) return null;

  const db = getWebDb();
  await db
    .delete(albumAssets)
    .where(
      and(eq(albumAssets.albumId, albumId), eq(albumAssets.assetId, assetId)),
    );

  return { albumId, assetId };
}

export async function addAlbumMember(
  actorUserId: string,
  albumId: string,
  username: string,
  role: "editor" | "viewer",
) {
  const access = await getAlbumAccess(actorUserId, albumId);
  if (!access?.canManageMembers) return null;

  const db = getWebDb();
  const normalized = username.trim().toLowerCase();
  const [user] = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(
      and(
        eq(sql`lower(${users.username})`, normalized),
        eq(users.approvalStatus, "approved"),
      ),
    )
    .limit(1);

  if (!user || user.id === access.ownerUserId) return null;

  await db
    .insert(albumMembers)
    .values({
      albumId,
      userId: user.id,
      role,
      invitedByUserId: actorUserId,
    })
    .onConflictDoUpdate({
      target: [albumMembers.albumId, albumMembers.userId],
      set: { role },
    });

  return { userId: user.id, username: user.username, role };
}

export async function updateAlbumMemberRole(
  actorUserId: string,
  albumId: string,
  memberUserId: string,
  role: "editor" | "viewer",
) {
  const access = await getAlbumAccess(actorUserId, albumId);
  if (!access?.canManageMembers) return null;

  const db = getWebDb();
  const [row] = await db
    .update(albumMembers)
    .set({ role })
    .where(
      and(
        eq(albumMembers.albumId, albumId),
        eq(albumMembers.userId, memberUserId),
      ),
    )
    .returning();

  return row ?? null;
}

export async function removeAlbumMember(
  actorUserId: string,
  albumId: string,
  memberUserId: string,
) {
  const access = await getAlbumAccess(actorUserId, albumId);
  if (!access) return null;

  // Owner can remove anyone; members can leave themselves
  if (!access.canManageMembers && actorUserId !== memberUserId) {
    return null;
  }

  const db = getWebDb();
  const [row] = await db
    .delete(albumMembers)
    .where(
      and(
        eq(albumMembers.albumId, albumId),
        eq(albumMembers.userId, memberUserId),
      ),
    )
    .returning({ userId: albumMembers.userId });

  return row ?? null;
}
