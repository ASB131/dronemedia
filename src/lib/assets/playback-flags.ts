import { eq } from "drizzle-orm";

import { videoHlsPlaylistKey } from "@/lib/assets/hls";
import { videoProxyCacheKey } from "@/lib/assets/transcoding";
import { getWebDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { getStorageAdapter } from "@/lib/storage";

export async function setAssetPlaybackFlags(
  assetId: string,
  flags: { hasProxy?: boolean; hasHls?: boolean },
) {
  if (flags.hasProxy === undefined && flags.hasHls === undefined) return;
  const db = getWebDb();
  await db
    .update(assets)
    .set({
      ...(flags.hasProxy !== undefined ? { hasProxy: flags.hasProxy } : {}),
      ...(flags.hasHls !== undefined ? { hasHls: flags.hasHls } : {}),
      updatedAt: new Date(),
    })
    .where(eq(assets.id, assetId));
}

/** Sync DB flags from cache presence (and LRF-as-proxy). */
export async function refreshAssetPlaybackFlags(
  userId: string,
  assetId: string,
  options?: { hasLrf?: boolean },
) {
  const storage = getStorageAdapter();
  const [hasHls, hasCacheProxy] = await Promise.all([
    storage.exists(videoHlsPlaylistKey(userId, assetId), { tier: "cache" }),
    storage.exists(videoProxyCacheKey(userId, assetId), { tier: "cache" }),
  ]);
  const hasProxy = hasCacheProxy || Boolean(options?.hasLrf);
  await setAssetPlaybackFlags(assetId, { hasProxy, hasHls });
  return { hasProxy, hasHls };
}

export async function clearAssetPlaybackFlags(assetId: string) {
  await setAssetPlaybackFlags(assetId, { hasProxy: false, hasHls: false });
}
