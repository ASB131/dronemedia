import { and, desc, eq, sql } from "drizzle-orm";

import { binContentHashesForAssets } from "@/lib/assets/content-hash-bin";
import { mergePhotoMetadata } from "@/lib/assets/media-metadata";
import {
  panoramaDjiStitchedMediaKey,
  panoramaEquirectCacheKey,
  panoramaEquirectViewCacheKey,
  panoramaEquirectWebCacheKey,
} from "@/lib/assets/transcoding";
import { loadConfig } from "@/lib/config";
import { getWebDb, getWorkerDb } from "@/lib/db";
import { assetFiles, assets } from "@/lib/db/schema";
import { getPanoramaStitchQueue } from "@/lib/jobs/queues";
import { getStorageAdapter, buildMediaAssetKey } from "@/lib/storage";
import { normalizeBasename } from "@/lib/upload/filename";
import {
  panoramaFolderCaptureIndex,
  parseDjiStitchedPanoramaFilename,
} from "@/lib/upload/sequences";

function db() {
  try {
    return getWorkerDb();
  } catch {
    return getWebDb();
  }
}

export async function findPanoramaForCaptureIndex(
  userId: string,
  captureIndex: string,
) {
  const rows = await db()
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.userId, userId),
        eq(assets.assetType, "sequence"),
        eq(assets.sequenceKind, "panorama"),
        sql`${assets.deletedAt} is null`,
        sql`(
          ${assets.sequenceFolder} = ${captureIndex}
          or ${assets.sequenceFolder} = ${`100_${captureIndex}`}
          or ${assets.sequenceFolder} like ${`%_${captureIndex}`}
        )`,
      ),
    )
    .orderBy(desc(assets.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function findDjiPhotoForCaptureIndex(
  userId: string,
  captureIndex: string,
) {
  const key = normalizeBasename(`DJI_${captureIndex}`);
  const rows = await db()
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.userId, userId),
        eq(assets.assetType, "photo"),
        sql`${assets.deletedAt} is null`,
        sql`(
          lower(regexp_replace(${assets.displayName}, '\\.[^.]+$', '')) = ${key}
          or (
            ${assets.displayName} ilike ${`%${captureIndex}%`}
            and (
              ${assets.mediaMetadata}->>'panoramaSphere' is not null
              or ${assets.mediaMetadata}->>'panoramaWidth' is not null
              or ${assets.mediaMetadata}->>'panoramaViewer' in ('180', '360')
            )
          )
        )`,
      ),
    )
    .orderBy(desc(assets.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function panoramaHasDjiStitch(
  userId: string,
  panoramaId: string,
): Promise<boolean> {
  const storage = getStorageAdapter();
  if (
    await storage.exists(panoramaDjiStitchedMediaKey(userId, panoramaId), {
      tier: "media",
    })
  ) {
    return true;
  }
  const [row] = await db()
    .select({ id: assetFiles.id })
    .from(assetFiles)
    .where(
      and(
        eq(assetFiles.assetId, panoramaId),
        eq(assetFiles.extension, "dji-pano.jpg"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function clearPanoramaEquirectCache(
  userId: string,
  assetId: string,
) {
  const storage = getStorageAdapter();
  await storage
    .delete(panoramaEquirectCacheKey(userId, assetId), { tier: "cache" })
    .catch(() => undefined);
  await storage
    .delete(panoramaEquirectViewCacheKey(userId, assetId), { tier: "cache" })
    .catch(() => undefined);
  await storage
    .delete(panoramaEquirectWebCacheKey(userId, assetId), { tier: "cache" })
    .catch(() => undefined);
}

export async function enqueuePanoramaRestitch(
  userId: string,
  assetId: string,
) {
  const config = loadConfig();
  const { isJobGateEnabled } = await import("@/lib/jobs/gates");
  const { JOB_NAMES } = await import("@/lib/jobs/types");
  if (!isJobGateEnabled(JOB_NAMES.PANORAMA_STITCH, true)) {
    return;
  }
  await clearPanoramaEquirectCache(userId, assetId);
  await getPanoramaStitchQueue().add(
    "panoramaStitch",
    { userId, assetId },
    {
      attempts: config.jobs.retry.attempts,
      backoff: {
        type: "exponential",
        delay: config.jobs.retry.backoffMs,
      },
    },
  );
}

/**
 * Move an already-committed photo asset onto a panorama as the DJI stitch.
 * Soft-deletes the photo afterward.
 */
export async function adoptPhotoAssetAsDjiStitch(params: {
  userId: string;
  panoramaId: string;
  photoId: string;
  restitch?: boolean;
}): Promise<boolean> {
  const { userId, panoramaId, photoId, restitch = true } = params;
  const database = db();
  const storage = getStorageAdapter();

  const [photo] = await database
    .select()
    .from(assets)
    .where(and(eq(assets.id, photoId), eq(assets.userId, userId)))
    .limit(1);
  if (!photo || photo.assetType !== "photo") return false;

  if (await panoramaHasDjiStitch(userId, panoramaId)) {
    // Already have a stitch — just bin the duplicate photo.
    await database
      .update(assets)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(assets.id, photoId));
    await binContentHashesForAssets([photoId]);
    return true;
  }

  const ext = photo.mainFileExt || "jpg";
  const photoKey = buildMediaAssetKey(userId, photoId, ext);
  const destKey = panoramaDjiStitchedMediaKey(userId, panoramaId);

  try {
    await storage.move(photoKey, destKey, {
      fromTier: "media",
      toTier: "media",
    });
  } catch {
    return false;
  }

  await database
    .update(assetFiles)
    .set({
      assetId: panoramaId,
      extension: "dji-pano.jpg",
    })
    .where(
      and(eq(assetFiles.assetId, photoId), eq(assetFiles.extension, ext)),
    );

  const [panorama] = await database
    .select()
    .from(assets)
    .where(eq(assets.id, panoramaId))
    .limit(1);

  const photoMeta =
    photo.mediaMetadata?.kind === "photo" ? photo.mediaMetadata : null;
  const panoMeta =
    panorama?.mediaMetadata?.kind === "photo" ? panorama.mediaMetadata : null;

  // Prefer stitch EXIF (camera / exposure) and fill any gaps from the panorama.
  const nextMeta = photoMeta
    ? mergePhotoMetadata(photoMeta, panoMeta)
    : panoMeta;

  await database
    .update(assets)
    .set({
      fileSizeBytes: sql`coalesce(${assets.fileSizeBytes}, 0) + ${photo.fileSizeBytes ?? 0}`,
      locationOriginal: panorama?.locationOriginal ?? photo.locationOriginal,
      capturedAtOriginal:
        panorama?.capturedAtOriginal ?? photo.capturedAtOriginal,
      capturedTimezone: panorama?.capturedTimezone ?? photo.capturedTimezone,
      mediaMetadata: nextMeta ?? panorama?.mediaMetadata ?? photo.mediaMetadata,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, panoramaId));

  await database
    .update(assets)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(assets.id, photoId));
  await binContentHashesForAssets([photoId]);

  if (restitch) {
    await enqueuePanoramaRestitch(userId, panoramaId);
  }
  return true;
}

export function captureIndexFromPanoramaAsset(asset: {
  sequenceFolder: string | null;
  displayName: string;
}): string | null {
  return (
    panoramaFolderCaptureIndex(asset.sequenceFolder) ??
    panoramaFolderCaptureIndex(asset.displayName) ??
    parseDjiStitchedPanoramaFilename(asset.displayName)?.captureIndex ??
    null
  );
}

/**
 * Convert a standalone stitch photo into a panorama sequence shell (same id),
 * moving the main JPEG to dji-pano.jpg. Caller attaches tile frames afterward.
 */
export async function promoteStitchPhotoToPanoramaShell(params: {
  userId: string;
  photoId: string;
  folderLabel: string;
  displayName: string;
}): Promise<boolean> {
  const { userId, photoId, folderLabel, displayName } = params;
  const database = db();
  const storage = getStorageAdapter();

  const [photo] = await database
    .select()
    .from(assets)
    .where(and(eq(assets.id, photoId), eq(assets.userId, userId)))
    .limit(1);
  if (!photo || photo.assetType !== "photo") return false;

  const ext = photo.mainFileExt || "jpg";
  const photoKey = buildMediaAssetKey(userId, photoId, ext);
  const destKey = panoramaDjiStitchedMediaKey(userId, photoId);

  if (!(await panoramaHasDjiStitch(userId, photoId))) {
    try {
      await storage.move(photoKey, destKey, {
        fromTier: "media",
        toTier: "media",
      });
    } catch {
      return false;
    }

    await database
      .update(assetFiles)
      .set({ extension: "dji-pano.jpg" })
      .where(
        and(eq(assetFiles.assetId, photoId), eq(assetFiles.extension, ext)),
      );
  }

  const keepName =
    parseDjiStitchedPanoramaFilename(photo.displayName) == null &&
    !/^dji_\d+/i.test(photo.displayName.replace(/\.[^.]+$/, ""));

  await database
    .update(assets)
    .set({
      assetType: "sequence",
      mainFileExt: "seq",
      sequenceKind: "panorama",
      sequenceFolder: folderLabel,
      sequenceFps: null,
      frameCount: 0,
      displayName: keepName ? photo.displayName : displayName,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, photoId));

  const [seqRow] = await database
    .select({ id: assetFiles.id })
    .from(assetFiles)
    .where(
      and(eq(assetFiles.assetId, photoId), eq(assetFiles.extension, "seq")),
    )
    .limit(1);

  if (!seqRow) {
    // Distinct from the dji-pano.jpg row (unique on user_id + content_hash).
    await database.insert(assetFiles).values({
      assetId: photoId,
      userId,
      extension: "seq",
      contentHash: `seq:${photoId}`,
      fileSizeBytes: photo.fileSizeBytes ?? 0,
    });
  }

  return true;
}
