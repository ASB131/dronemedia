import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

import { readExifToolTags } from "@/lib/assets/exiftool";
import {
  emptyPhotoMetadata,
  mergePhotoMetadata,
  type MediaMetadata,
  type PhotoMediaMetadata,
} from "@/lib/assets/media-metadata";
import { poseHeadingDegreesFromTags } from "@/lib/assets/panorama-heading";
import { panoramaDjiStitchedMediaKey } from "@/lib/assets/transcoding";
import { getWebDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { buildMediaAssetKey, getStorageAdapter } from "@/lib/storage";

function emptyPhotoMeta(): PhotoMediaMetadata {
  return emptyPhotoMetadata();
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Camera / size fields from ExifTool — used to repair wiped metadata. */
function photoFieldsFromTags(tags: Record<string, unknown>): Partial<PhotoMediaMetadata> {
  return {
    width:
      asNumber(tags.ImageWidth) ??
      asNumber(tags.ExifImageWidth) ??
      asNumber(tags.CroppedAreaImageWidthPixels) ??
      asNumber(tags.FullPanoWidthPixels),
    height:
      asNumber(tags.ImageHeight) ??
      asNumber(tags.ExifImageHeight) ??
      asNumber(tags.CroppedAreaImageHeightPixels) ??
      asNumber(tags.FullPanoHeightPixels),
    cameraMake: asString(tags.Make),
    cameraModel: asString(tags.Model),
    lensMake: asString(tags.LensMake),
    lensModel: asString(tags.LensModel) ?? asString(tags.LensID),
    software: asString(tags.Software),
    fNumber: asNumber(tags.FNumber) ?? asNumber(tags.Aperture),
    exposureTimeSeconds: asNumber(tags.ExposureTime),
    iso: asNumber(tags.ISO) ?? asNumber(tags.ISOSpeed),
    exposureBias:
      asNumber(tags.ExposureCompensation) ?? asNumber(tags.ExposureBiasValue),
    focalLengthMm: asNumber(tags.FocalLength),
    altitudeMeters: asNumber(tags.GPSAltitude),
  };
}

function needsCameraRepair(meta: PhotoMediaMetadata): boolean {
  return (
    meta.width == null &&
    meta.height == null &&
    meta.cameraMake == null &&
    meta.cameraModel == null &&
    meta.panoramaWidth == null
  );
}

/**
 * Patch pose heading onto existing photo metadata (never replace the whole
 * blob with an empty template). Re-reads ExifTool and repairs camera fields
 * when they were previously wiped.
 */
export async function ensurePanoramaPoseHeading(
  ownerUserId: string,
  assetId: string,
  mediaMetadata: MediaMetadata | null,
  opts?: { mainFileExt?: string | null },
): Promise<MediaMetadata | null> {
  // Fast path: heading already known and camera fields look intact.
  if (
    mediaMetadata?.kind === "photo" &&
    typeof mediaMetadata.panoramaPoseHeadingDegrees === "number" &&
    Number.isFinite(mediaMetadata.panoramaPoseHeadingDegrees) &&
    !needsCameraRepair(mediaMetadata)
  ) {
    return mediaMetadata;
  }

  const storage = getStorageAdapter();
  const djiKey = panoramaDjiStitchedMediaKey(ownerUserId, assetId);
  let bytes =
    (await storage.get(djiKey, { tier: "media" })) ?? null;

  if (!bytes && opts?.mainFileExt) {
    const mainKey = buildMediaAssetKey(
      ownerUserId,
      assetId,
      opts.mainFileExt,
    );
    bytes = (await storage.get(mainKey, { tier: "media" })) ?? null;
  }

  if (!bytes) return mediaMetadata;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pano-heading-"));
  const tmpFile = path.join(tmpDir, "pano.jpg");
  try {
    await fs.writeFile(tmpFile, bytes);
    const tags = await readExifToolTags(tmpFile);
    if (!tags) return mediaMetadata;

    const heading = poseHeadingDegreesFromTags(tags);
    const db = getWebDb();
    const [row] = await db
      .select({ mediaMetadata: assets.mediaMetadata })
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);

    const fromDb =
      row?.mediaMetadata?.kind === "photo" ? row.mediaMetadata : null;
    const fromArg =
      mediaMetadata?.kind === "photo" ? mediaMetadata : null;
    // Prefer whichever copy still has camera/size fields.
    const base =
      (fromDb && !needsCameraRepair(fromDb) ? fromDb : null) ??
      (fromArg && !needsCameraRepair(fromArg) ? fromArg : null) ??
      fromDb ??
      fromArg ??
      emptyPhotoMeta();

    const repair = needsCameraRepair(base) ? photoFieldsFromTags(tags) : {};
    const width = repair.width ?? base.width;
    const height = repair.height ?? base.height;

    let next = mergePhotoMetadata(base, {
      ...repair,
      panoramaPoseHeadingDegrees:
        heading ?? base.panoramaPoseHeadingDegrees ?? null,
    });
    if (heading != null) {
      next.panoramaPoseHeadingDegrees = heading;
    }
    next.panoramaHeadingOverrideDegrees =
      fromDb?.panoramaHeadingOverrideDegrees ??
      fromArg?.panoramaHeadingOverrideDegrees ??
      base.panoramaHeadingOverrideDegrees ??
      null;
    // Keep panorama canvas size in sync with the stitch when repairing.
    if (next.panoramaWidth == null && width != null) {
      next.panoramaWidth = width;
    }
    if (next.panoramaHeight == null && height != null) {
      next.panoramaHeight = height;
    }
    if (next.panoramaSphere == null && width != null && height != null && height > 0) {
      const ratio = width / height;
      next.panoramaSphere = ratio >= 1.9 && ratio <= 2.1;
    }
    if (next.panoramaViewer == null && next.panoramaSphere != null) {
      next.panoramaViewer = next.panoramaSphere ? "360" : "180";
    }

    const unchanged =
      JSON.stringify(next) === JSON.stringify(base) &&
      fromArg != null &&
      JSON.stringify(next) === JSON.stringify(fromArg);
    if (unchanged) {
      return next;
    }

    await db
      .update(assets)
      .set({ mediaMetadata: next, updatedAt: new Date() })
      .where(eq(assets.id, assetId));

    return next;
  } catch {
    return mediaMetadata;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
