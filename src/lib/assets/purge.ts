import fsp from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";

import type { Database } from "@/lib/db";
import { assetFiles, assets } from "@/lib/db/schema";
import {
  deleteFlightIfNoAssets,
  deleteSharesForTarget,
} from "@/lib/library/orphan-cleanup";
import { loadConfig } from "@/lib/config";
import { buildMediaAssetKey, getStorageAdapter } from "@/lib/storage";
import { videoHlsPrefix } from "@/lib/assets/hls";
import {
  placeholderThumbnailCacheKey,
  photoWebPreviewCacheKey,
  thumbnailCacheKey,
} from "@/lib/assets/thumbnails";
import {
  panoramaEquirectCacheKey,
  panoramaEquirectViewCacheKey,
  panoramaEquirectWebCacheKey,
  videoProxyCacheKey,
} from "@/lib/assets/transcoding";
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
  // Frame thumbs + mid-res zoom-to-tile previews live under these prefixes.
  await storage.deletePrefix(`thumbnails/${userId}/${assetId}`, {
    tier: "cache",
  });
  await storage.deletePrefix(`previews/${userId}/${assetId}`, {
    tier: "cache",
  });
  await storage.delete(videoProxyCacheKey(userId, assetId), { tier: "cache" });
  await storage.deletePrefix(videoHlsPrefix(userId, assetId), {
    tier: "cache",
  });
  await storage.delete(panoramaEquirectCacheKey(userId, assetId), {
    tier: "cache",
  });
  await storage.delete(panoramaEquirectViewCacheKey(userId, assetId), {
    tier: "cache",
  });
  await storage.delete(panoramaEquirectWebCacheKey(userId, assetId), {
    tier: "cache",
  });
  // Wipe whole pano cache dir (versioned filenames / leftovers).
  await storage.deletePrefix(`panos/${userId}/${assetId}`, { tier: "cache" });

  // Sequence / LUT export MP4s: exports/{userId}/{assetId}-*.mp4
  try {
    const config = loadConfig();
    const exportsDir = path.join(config.storage.cachePath, "exports", userId);
    const entries = await fsp.readdir(exportsDir);
    for (const entry of entries) {
      if (!entry.startsWith(`${assetId}-`) && entry !== assetId) continue;
      await storage.delete(`exports/${userId}/${entry}`, { tier: "cache" });
    }
  } catch {
    // exports dir may not exist
  }

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
