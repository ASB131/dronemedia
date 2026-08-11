import { and, eq, isNull } from "drizzle-orm";

import type { MediaMetadata } from "@/lib/assets/media-metadata";
import {
  photoWebPreviewCacheKey,
  thumbnailCacheKey,
} from "@/lib/assets/thumbnails";
import { loadConfig } from "@/lib/config";
import { getThumbnailsQueue } from "@/lib/jobs/queues";
import { colorModeFromMediaMetadata } from "@/lib/luts/color-profile";
import { assets, luts, users } from "@/lib/db/schema";
import { getStorageAdapter } from "@/lib/storage";

/**
 * If the asset has no preferred LUT yet and its color mode matches a user
 * default (D-Log / D-Log M), assign that LUT and refresh the thumbnail.
 */
export async function applyDefaultPreferredLutIfNeeded(
  // Drizzle db from web or worker
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  options: {
    userId: string;
    assetId: string;
    mediaMetadata?: MediaMetadata | null;
    /** When false, skip thumbnail invalidate/requeue (default true). */
    requeueThumbnail?: boolean;
  },
): Promise<boolean> {
  const [asset] = await db
    .select({
      preferredLutId: assets.preferredLutId,
      mediaMetadata: assets.mediaMetadata,
      assetType: assets.assetType,
    })
    .from(assets)
    .where(
      and(
        eq(assets.id, options.assetId),
        eq(assets.userId, options.userId),
        isNull(assets.deletedAt),
      ),
    )
    .limit(1);

  if (!asset || asset.assetType !== "video" || asset.preferredLutId) {
    return false;
  }

  const colorMode = colorModeFromMediaMetadata(
    options.mediaMetadata ?? asset.mediaMetadata,
  );
  if (!colorMode) return false;

  const [user] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, options.userId))
    .limit(1);

  const lutId =
    colorMode === "d_logm"
      ? user?.preferences?.defaultDLogMLutId
      : user?.preferences?.defaultDLogLutId;

  if (!lutId || typeof lutId !== "string") return false;

  const [lut] = await db
    .select({ id: luts.id, colorProfile: luts.colorProfile })
    .from(luts)
    .where(eq(luts.id, lutId))
    .limit(1);

  if (!lut || lut.colorProfile !== colorMode) return false;

  await db
    .update(assets)
    .set({ preferredLutId: lutId, updatedAt: new Date() })
    .where(eq(assets.id, options.assetId));

  if (options.requeueThumbnail === false) return true;

  try {
    const storage = getStorageAdapter();
    const config = loadConfig();
    await storage.delete(thumbnailCacheKey(options.userId, options.assetId), {
      tier: "cache",
    });
    await storage.delete(
      photoWebPreviewCacheKey(options.userId, options.assetId),
      { tier: "cache" },
    );
    await getThumbnailsQueue().add(
      "thumbnails",
      { userId: options.userId, assetId: options.assetId },
      {
        jobId: `thumbnails-default-lut-${options.assetId}-${Date.now()}`,
        attempts: config.jobs.retry.attempts,
        backoff: {
          type: "exponential",
          delay: config.jobs.retry.backoffMs,
        },
      },
    );
  } catch {
    // Thumbnail refresh is best-effort; LUT is already assigned.
  }

  return true;
}
