import { eq } from "drizzle-orm";

import type { Database } from "@/lib/db";
import { assetFiles, assets } from "@/lib/db/schema";
import {
  deleteFlightIfNoAssets,
  deleteSharesForTarget,
} from "@/lib/library/orphan-cleanup";
import { buildMediaAssetKey, getStorageAdapter } from "@/lib/storage";
import { videoHlsPrefix } from "@/lib/assets/hls";
import {
  placeholderThumbnailCacheKey,
  photoWebPreviewCacheKey,
  thumbnailCacheKey,
} from "@/lib/assets/thumbnails";
import { videoProxyCacheKey } from "@/lib/assets/transcoding";
import { reconcileUserStorageUsed } from "@/lib/users/storage-usage";

export async function purgeAssetPermanently(
  db: Database,
  userId: string,
  assetId: string,
  options?: { skipStorageReconcile?: boolean },
) {
  const storage = getStorageAdapter();

  const [asset] = await db
    .select({ id: assets.id, flightId: assets.flightId })
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);

  if (!asset) return false;

  const files = await db
    .select({ extension: assetFiles.extension })
    .from(assetFiles)
    .where(eq(assetFiles.assetId, assetId));

  for (const file of files) {
    const key = buildMediaAssetKey(userId, assetId, file.extension);
    await storage.delete(key, { tier: "media" });
  }

  // Remove the whole asset media directory (avoids empty UUID folders).
  await storage.deletePrefix(`${userId}/${assetId}`, { tier: "media" });

  await storage.delete(thumbnailCacheKey(userId, assetId), { tier: "cache" });
  await storage.delete(placeholderThumbnailCacheKey(userId, assetId), {
    tier: "cache",
  });
  await storage.delete(photoWebPreviewCacheKey(userId, assetId), {
    tier: "cache",
  });
  await storage.delete(videoProxyCacheKey(userId, assetId), { tier: "cache" });
  await storage.deletePrefix(videoHlsPrefix(userId, assetId), {
    tier: "cache",
  });

  await db.delete(assets).where(eq(assets.id, assetId));

  await deleteSharesForTarget(db, userId, "asset", assetId);

  if (asset.flightId) {
    await deleteFlightIfNoAssets(db, asset.flightId);
  }

  if (!options?.skipStorageReconcile) {
    await reconcileUserStorageUsed(userId, db);
  }

  return true;
}
