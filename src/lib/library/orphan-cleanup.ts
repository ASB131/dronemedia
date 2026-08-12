import fsp from "node:fs/promises";
import path from "node:path";

import { and, eq, isNull, sql } from "drizzle-orm";

import { loadConfig } from "@/lib/config";
import type { Database } from "@/lib/db";
import { getWebDb } from "@/lib/db";
import {
  albumAssets,
  albums,
  assets,
  flights,
  shares,
} from "@/lib/db/schema";
import { getLogger } from "@/lib/logger";
import { getStorageAdapter } from "@/lib/storage";

const logger = getLogger().child({ module: "orphan-cleanup" });

const UUID_DIR =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function deleteFlightIfNoAssets(
  db: Database,
  flightId: string,
): Promise<boolean> {
  const [remaining] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.flightId, flightId))
    .limit(1);

  if (remaining) return false;

  const deleted = await db
    .delete(flights)
    .where(eq(flights.id, flightId))
    .returning({ id: flights.id });

  if (deleted.length > 0) {
    await db
      .delete(shares)
      .where(
        and(eq(shares.targetType, "flight"), eq(shares.targetId, flightId)),
      );
  }

  return deleted.length > 0;
}

export async function revokeSharesForTarget(
  db: Database,
  ownerUserId: string,
  targetType: "asset" | "flight" | "album",
  targetId: string,
) {
  await db
    .update(shares)
    .set({ revoked: true, revokedAt: new Date() })
    .where(
      and(
        eq(shares.ownerUserId, ownerUserId),
        eq(shares.targetType, targetType),
        eq(shares.targetId, targetId),
        eq(shares.revoked, false),
      ),
    );
}

export async function deleteSharesForTarget(
  db: Database,
  ownerUserId: string,
  targetType: "asset" | "flight" | "album",
  targetId: string,
) {
  await db
    .delete(shares)
    .where(
      and(
        eq(shares.ownerUserId, ownerUserId),
        eq(shares.targetType, targetType),
        eq(shares.targetId, targetId),
      ),
    );
}

/** After soft-delete: revoke asset share + flight share if no live media left. */
export async function afterAssetsSoftDeleted(
  userId: string,
  assetIds: string[],
  flightIds: Array<string | null | undefined>,
) {
  if (assetIds.length === 0) return;
  const db = getWebDb();

  for (const assetId of assetIds) {
    await revokeSharesForTarget(db, userId, "asset", assetId);
  }

  const uniqueFlightIds = [
    ...new Set(flightIds.filter((id): id is string => Boolean(id))),
  ];

  for (const flightId of uniqueFlightIds) {
    const [live] = await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.flightId, flightId), isNull(assets.deletedAt)))
      .limit(1);
    if (!live) {
      await revokeSharesForTarget(db, userId, "flight", flightId);
    }
  }
}

export async function deleteEmptyFlightsForUser(userId: string) {
  const db = getWebDb();
  const empty = await db
    .select({ id: flights.id })
    .from(flights)
    .where(
      and(
        eq(flights.userId, userId),
        sql`not exists (
          select 1 from assets a where a.flight_id = ${flights.id}
        )`,
      ),
    );

  let deleted = 0;
  for (const row of empty) {
    const ok = await deleteFlightIfNoAssets(db, row.id);
    if (ok) deleted += 1;
  }
  return deleted;
}

export async function cleanupOrphanSharesForUser(userId: string) {
  const db = getWebDb();
  const rows = await db
    .select({
      id: shares.id,
      targetType: shares.targetType,
      targetId: shares.targetId,
      revoked: shares.revoked,
    })
    .from(shares)
    .where(eq(shares.ownerUserId, userId));

  let revoked = 0;
  let removed = 0;

  for (const row of rows) {
    if (row.targetType === "asset") {
      const [asset] = await db
        .select({
          id: assets.id,
          deletedAt: assets.deletedAt,
        })
        .from(assets)
        .where(and(eq(assets.id, row.targetId), eq(assets.userId, userId)))
        .limit(1);

      if (!asset) {
        await db.delete(shares).where(eq(shares.id, row.id));
        removed += 1;
        continue;
      }

      if (asset.deletedAt && !row.revoked) {
        await db
          .update(shares)
          .set({ revoked: true, revokedAt: new Date() })
          .where(eq(shares.id, row.id));
        revoked += 1;
      }
      continue;
    }

    if (row.targetType === "flight") {
      const [flight] = await db
        .select({ id: flights.id })
        .from(flights)
        .where(and(eq(flights.id, row.targetId), eq(flights.userId, userId)))
        .limit(1);

      if (!flight) {
        await db.delete(shares).where(eq(shares.id, row.id));
        removed += 1;
        continue;
      }

      const [live] = await db
        .select({ id: assets.id })
        .from(assets)
        .where(
          and(eq(assets.flightId, row.targetId), isNull(assets.deletedAt)),
        )
        .limit(1);

      if (!live && !row.revoked) {
        await db
          .update(shares)
          .set({ revoked: true, revokedAt: new Date() })
          .where(eq(shares.id, row.id));
        revoked += 1;
      }
      continue;
    }

    if (row.targetType === "album") {
      const [album] = await db
        .select({ id: albums.id })
        .from(albums)
        .where(and(eq(albums.id, row.targetId), eq(albums.userId, userId)))
        .limit(1);

      if (!album) {
        await db.delete(shares).where(eq(shares.id, row.id));
        removed += 1;
        continue;
      }

      const [live] = await db
        .select({ id: assets.id })
        .from(albumAssets)
        .innerJoin(assets, eq(assets.id, albumAssets.assetId))
        .where(
          and(eq(albumAssets.albumId, row.targetId), isNull(assets.deletedAt)),
        )
        .limit(1);

      if (!live && !row.revoked) {
        await db
          .update(shares)
          .set({ revoked: true, revokedAt: new Date() })
          .where(eq(shares.id, row.id));
        revoked += 1;
      }
    }
  }

  return { revoked, removed };
}

/** Remove leftover MEDIA_PATH/{userId}/{assetUuid}/ dirs with no matching asset row. */
export async function cleanupOrphanMediaFolders(userId: string) {
  const config = loadConfig();
  const userDir = path.join(config.storage.mediaPath, userId);
  const storage = getStorageAdapter();

  let entries: string[];
  try {
    entries = await fsp.readdir(userDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { removed: 0 };
    }
    throw error;
  }

  const db = getWebDb();
  const known = await db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.userId, userId));
  const knownIds = new Set(known.map((row) => row.id));

  let removed = 0;
  for (const entry of entries) {
    if (!UUID_DIR.test(entry) || knownIds.has(entry)) continue;

    const fullPath = path.join(userDir, entry);
    try {
      const stat = await fsp.stat(fullPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    await storage.deletePrefix(`${userId}/${entry}`, { tier: "media" });
    removed += 1;
  }

  // Drop empty user media root when nothing remains.
  try {
    const left = await fsp.readdir(userDir);
    if (left.length === 0) {
      await fsp.rmdir(userDir);
    }
  } catch {
    // ignore
  }

  return { removed };
}

const CACHE_ASSET_BUCKETS = [
  "thumbnails",
  "proxies",
  "hls",
  "panos",
  "previews",
] as const;

/**
 * Remove cache derivatives (thumbs/HLS/panos/…) for asset ids that no longer
 * exist in the DB (e.g. after emptying the bin). Soft-deleted assets keep cache.
 */
export async function cleanupOrphanCacheFolders(userId: string) {
  const config = loadConfig();
  const cacheRoot = config.storage.cachePath;
  const storage = getStorageAdapter();
  const db = getWebDb();

  const known = await db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.userId, userId));
  const knownIds = new Set(known.map((row) => row.id));

  let removed = 0;

  for (const bucket of CACHE_ASSET_BUCKETS) {
    const userDir = path.join(cacheRoot, bucket, userId);
    let entries: string[];
    try {
      entries = await fsp.readdir(userDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }

    for (const entry of entries) {
      const assetId = entry.replace(/\.[^.]+$/, "");
      if (!UUID_DIR.test(assetId) || knownIds.has(assetId)) continue;

      const fullPath = path.join(userDir, entry);
      try {
        const stat = await fsp.stat(fullPath);
        if (stat.isDirectory()) {
          await storage.deletePrefix(`${bucket}/${userId}/${entry}`, {
            tier: "cache",
          });
        } else {
          await storage.delete(`${bucket}/${userId}/${entry}`, {
            tier: "cache",
          });
        }
        removed += 1;
      } catch {
        // ignore missing
      }
    }

    try {
      const left = await fsp.readdir(userDir);
      if (left.length === 0) await fsp.rmdir(userDir);
    } catch {
      // ignore
    }
  }

  // exports/{userId}/{assetId}-*.mp4
  const exportsDir = path.join(cacheRoot, "exports", userId);
  try {
    const exportEntries = await fsp.readdir(exportsDir);
    for (const entry of exportEntries) {
      const match = entry.match(
        /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i,
      );
      const assetId = match?.[1];
      if (!assetId || knownIds.has(assetId)) continue;
      await storage.delete(`exports/${userId}/${entry}`, { tier: "cache" });
      removed += 1;
    }
    const left = await fsp.readdir(exportsDir);
    if (left.length === 0) await fsp.rmdir(exportsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  // Empty uploads/{userId} staging dirs (no nested sessions left).
  const uploadsUserDir = path.join(cacheRoot, "uploads", userId);
  try {
    const uploadEntries = await fsp.readdir(uploadsUserDir);
    if (uploadEntries.length === 0) {
      await fsp.rmdir(uploadsUserDir);
      removed += 1;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  return { removed };
}

export async function cleanupLibraryOrphans(userId: string) {
  const emptyFlights = await deleteEmptyFlightsForUser(userId);
  const sharesResult = await cleanupOrphanSharesForUser(userId);
  const media = await cleanupOrphanMediaFolders(userId);
  const cache = await cleanupOrphanCacheFolders(userId);

  logger.info(
    {
      userId,
      emptyFlights,
      sharesRevoked: sharesResult.revoked,
      sharesRemoved: sharesResult.removed,
      mediaFoldersRemoved: media.removed,
      cacheFoldersRemoved: cache.removed,
    },
    "Library orphan cleanup complete",
  );

  return {
    emptyFlights,
    sharesRevoked: sharesResult.revoked,
    sharesRemoved: sharesResult.removed,
    mediaFoldersRemoved: media.removed,
    cacheFoldersRemoved: cache.removed,
  };
}
