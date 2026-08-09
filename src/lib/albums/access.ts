import { and, eq } from "drizzle-orm";

import { getWebDb } from "@/lib/db";
import { albumMembers, albums } from "@/lib/db/schema";

export type AlbumAccessRole = "owner" | "editor" | "viewer";

export type AlbumAccess = {
  albumId: string;
  ownerUserId: string;
  role: AlbumAccessRole;
  canEdit: boolean;
  canManageMembers: boolean;
};

export async function getAlbumAccess(
  userId: string,
  albumId: string,
): Promise<AlbumAccess | null> {
  const db = getWebDb();
  const [album] = await db
    .select({
      id: albums.id,
      ownerUserId: albums.userId,
    })
    .from(albums)
    .where(eq(albums.id, albumId))
    .limit(1);

  if (!album) return null;

  if (album.ownerUserId === userId) {
    return {
      albumId: album.id,
      ownerUserId: album.ownerUserId,
      role: "owner",
      canEdit: true,
      canManageMembers: true,
    };
  }

  const [member] = await db
    .select({ role: albumMembers.role })
    .from(albumMembers)
    .where(
      and(eq(albumMembers.albumId, albumId), eq(albumMembers.userId, userId)),
    )
    .limit(1);

  if (!member) return null;

  return {
    albumId: album.id,
    ownerUserId: album.ownerUserId,
    role: member.role,
    canEdit: member.role === "editor",
    canManageMembers: false,
  };
}
