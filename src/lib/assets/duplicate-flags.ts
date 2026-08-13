import { and, asc, eq, inArray, isNull, like } from "drizzle-orm";

import { getWebDb } from "@/lib/db";
import { assetFiles, assets } from "@/lib/db/schema";
import { thumbnailCacheKey } from "@/lib/assets/thumbnails";
import { enqueueAssetRefresh } from "@/lib/jobs/refresh-asset";
import { getStorageAdapter } from "@/lib/storage";
import {
  isPhotoExtension,
  isVideoExtension,
} from "@/lib/upload/filename";

const FALSE_DUP_PREFIX = "Possible duplicate of asset ";

/**
 * Clear auto "Possible duplicate…" descriptions where the pair does not share
 * a primary media content hash (e.g. false flags from shared SRT/LRF).
 */
export async function clearFalseDuplicateFlags(userId: string): Promise<{
  cleared: number;
}> {
  const db = getWebDb();
  const flagged = await db
    .select({
      id: assets.id,
      description: assets.description,
      contentHash: assets.contentHash,
    })
    .from(assets)
    .where(
      and(
        eq(assets.userId, userId),
        isNull(assets.deletedAt),
        like(assets.description, `${FALSE_DUP_PREFIX}%`),
      ),
    );

  let cleared = 0;
  for (const row of flagged) {
    const otherId = row.description?.slice(FALSE_DUP_PREFIX.length).trim();
    if (!otherId) continue;

    const [other] = await db
      .select({
        id: assets.id,
        contentHash: assets.contentHash,
      })
      .from(assets)
      .where(
        and(
          eq(assets.id, otherId),
          eq(assets.userId, userId),
          isNull(assets.deletedAt),
        ),
      )
      .limit(1);

    let samePrimary = false;
    if (
      other &&
      row.contentHash &&
      other.contentHash &&
      row.contentHash === other.contentHash
    ) {
      samePrimary = true;
    }

    if (!samePrimary && other) {
      const primaryHashes = await db
        .select({
          contentHash: assetFiles.contentHash,
          extension: assetFiles.extension,
          assetId: assetFiles.assetId,
        })
        .from(assetFiles)
        .where(
          and(
            eq(assetFiles.userId, userId),
            inArray(assetFiles.assetId, [row.id, other.id]),
          ),
        );

      const hashesByAsset = new Map<string, Set<string>>();
      for (const file of primaryHashes) {
        if (
          !isVideoExtension(file.extension) &&
          !isPhotoExtension(file.extension)
        ) {
          continue;
        }
        const set = hashesByAsset.get(file.assetId) ?? new Set();
        set.add(file.contentHash);
        hashesByAsset.set(file.assetId, set);
      }
      const a = hashesByAsset.get(row.id) ?? new Set();
      const b = hashesByAsset.get(other.id) ?? new Set();
      for (const hash of a) {
        if (b.has(hash)) {
          samePrimary = true;
          break;
        }
      }
    }

    if (samePrimary) continue;

    await db
      .update(assets)
      .set({ description: null, updatedAt: new Date() })
      .where(and(eq(assets.id, row.id), eq(assets.userId, userId)));
    cleared += 1;
  }

  return { cleared };
}

/** Delete thumb cache and requeue thumbnails for the user's assets (batched). */
export async function requeueThumbnailsForUser(
  userId: string,
  options?: { missingOnly?: boolean; limit?: number },
): Promise<{ queued: number }> {
  const db = getWebDb();
  const storage = getStorageAdapter();
  const limit = Math.min(Math.max(options?.limit ?? 200, 1), 500);

  const rows = await db
    .select({
      id: assets.id,
      displayName: assets.displayName,
    })
    .from(assets)
    .where(and(eq(assets.userId, userId), isNull(assets.deletedAt)))
    .orderBy(asc(assets.createdAt))
    .limit(limit);

  let queued = 0;
  for (const row of rows) {
    const key = thumbnailCacheKey(userId, row.id);
    if (options?.missingOnly) {
      const exists = await storage.exists(key, { tier: "cache" });
      if (exists) continue;
    } else {
      await storage.delete(key, { tier: "cache" }).catch(() => undefined);
    }

    await enqueueAssetRefresh({
      userId,
      assetId: row.id,
      assetName: row.displayName,
      options: {
        thumbnails: true,
        metadata: false,
        dedup: false,
      },
    });
    await db
      .update(assets)
      .set({ updatedAt: new Date() })
      .where(eq(assets.id, row.id));
    queued += 1;
  }

  return { queued };
}
