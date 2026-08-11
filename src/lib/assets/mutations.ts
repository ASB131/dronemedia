import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getOwnedAsset } from "@/lib/assets/access";
import { getEffectiveCaptureDate } from "@/lib/assets/capture";
import { binContentHashesForAssets } from "@/lib/assets/content-hash-bin";
import { videoHlsPrefix } from "@/lib/assets/hls";
import {
  withPanoramaViewerMode,
  type PanoramaViewerMode,
  type PhotoMediaMetadata,
} from "@/lib/assets/media-metadata";
import { clampSequenceFps } from "@/lib/assets/sequence-fps";
import { photoWebPreviewCacheKey, thumbnailCacheKey } from "@/lib/assets/thumbnails";
import {
  sequenceFullResExportKey,
  videoProxyCacheKey,
} from "@/lib/assets/transcoding";
import { loadConfig } from "@/lib/config";
import { getWebDb } from "@/lib/db";
import { assets, drones, luts } from "@/lib/db/schema";
import {
  getThumbnailsQueue,
  getWebTranscodingQueue,
} from "@/lib/jobs/queues";
import { colorModeFromMediaMetadata } from "@/lib/luts/color-profile";
import { afterAssetsSoftDeleted } from "@/lib/library/orphan-cleanup";
import { getStorageAdapter } from "@/lib/storage";

export type AssetUpdateInput = {
  displayName?: string;
  favorite?: boolean;
  isPublic?: boolean;
  description?: string | null;
  tags?: string[];
  capturedAtOverride?: Date | null;
  locationOverride?: { lat: number; lng: number } | null;
  droneId?: string | null;
  sequenceFps?: number;
  preferredLutId?: string | null;
  panoramaViewer?: PanoramaViewerMode;
};

function emptyPhotoMeta(): PhotoMediaMetadata {
  return {
    kind: "photo",
    width: null,
    height: null,
    cameraMake: null,
    cameraModel: null,
    lensMake: null,
    lensModel: null,
    software: null,
    fNumber: null,
    exposureTimeSeconds: null,
    iso: null,
    exposureBias: null,
    focalLengthMm: null,
    altitudeMeters: null,
    panoramaWidth: null,
    panoramaHeight: null,
    panoramaSphere: null,
    panoramaViewer: null,
    panoramaPoseHeadingDegrees: null,
  };
}

export async function updateOwnedAsset(
  userId: string,
  assetId: string,
  input: AssetUpdateInput,
) {
  const owned = await getOwnedAsset(userId, assetId);
  if (!owned) return null;

  const db = getWebDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };

  if (input.displayName !== undefined) set.displayName = input.displayName;
  if (input.favorite !== undefined) set.favorite = input.favorite;
  if (input.isPublic !== undefined) set.isPublic = input.isPublic;
  if (input.description !== undefined) set.description = input.description;
  if (input.tags !== undefined) set.tags = input.tags;
  if (input.capturedAtOverride !== undefined) {
    set.capturedAtOverride = input.capturedAtOverride;
  }
  if (input.locationOverride !== undefined) {
    set.locationOverride =
      input.locationOverride === null
        ? null
        : `SRID=4326;POINT(${input.locationOverride.lng} ${input.locationOverride.lat})`;
  }
  if (input.droneId !== undefined) {
    if (input.droneId === null) {
      set.droneId = null;
    } else {
      const [ownedDrone] = await db
        .select({ id: drones.id })
        .from(drones)
        .where(and(eq(drones.id, input.droneId), eq(drones.userId, userId)))
        .limit(1);
      if (!ownedDrone) return null;
      set.droneId = input.droneId;
    }
  }

  let fpsChanged = false;
  if (input.sequenceFps !== undefined) {
    if (owned.assetType !== "sequence") return null;
    if (owned.sequenceKind === "panorama") return null;
    const nextFps = clampSequenceFps(input.sequenceFps);
    if (owned.sequenceFps !== nextFps) {
      set.sequenceFps = nextFps;
      fpsChanged = true;
    }
  }

  let lutChanged = false;
  if (input.preferredLutId !== undefined) {
    if (owned.assetType !== "video") return null;
    const colorMode = colorModeFromMediaMetadata(owned.mediaMetadata);
    if (input.preferredLutId === null) {
      set.preferredLutId = null;
      lutChanged = owned.preferredLutId != null;
    } else {
      if (!colorMode) return null;
      const [lut] = await db
        .select({ id: luts.id, colorProfile: luts.colorProfile })
        .from(luts)
        .where(eq(luts.id, input.preferredLutId))
        .limit(1);
      if (!lut || lut.colorProfile !== colorMode) return null;
      set.preferredLutId = input.preferredLutId;
      lutChanged = owned.preferredLutId !== input.preferredLutId;
    }
  }

  if (input.panoramaViewer !== undefined) {
    const canSetViewer =
      owned.assetType === "photo" ||
      (owned.assetType === "sequence" && owned.sequenceKind === "panorama");
    if (!canSetViewer) return null;
    const base =
      owned.mediaMetadata?.kind === "photo"
        ? owned.mediaMetadata
        : emptyPhotoMeta();
    set.mediaMetadata = withPanoramaViewerMode(base, input.panoramaViewer);
  }

  const previousDroneId = owned.droneId;

  const [row] = await db
    .update(assets)
    .set(set)
    .where(and(eq(assets.id, assetId), eq(assets.userId, userId)))
    .returning({ id: assets.id, flightId: assets.flightId, droneId: assets.droneId });

  if (row && input.droneId !== undefined && row.flightId) {
    const { syncFlightDroneAssignment, refreshFlightStats } = await import(
      "@/lib/flights/queries"
    );
    await syncFlightDroneAssignment(db, row.flightId, row.droneId);
    await refreshFlightStats(db, row.flightId);
  }

  if (row && input.droneId !== undefined) {
    const { recomputeDroneFlightStatsForUser } = await import(
      "@/lib/drones/stats"
    );
    await recomputeDroneFlightStatsForUser(userId, previousDroneId);
    await recomputeDroneFlightStatsForUser(userId, row.droneId);
  }

  if (row && fpsChanged) {
    const storage = getStorageAdapter();
    const config = loadConfig();
    await Promise.all([
      storage.delete(videoProxyCacheKey(userId, assetId), { tier: "cache" }),
      storage.delete(sequenceFullResExportKey(userId, assetId), {
        tier: "cache",
      }),
      storage.deletePrefix(videoHlsPrefix(userId, assetId), { tier: "cache" }),
    ]);
    const { clearAssetPlaybackFlags } = await import(
      "@/lib/assets/playback-flags"
    );
    await clearAssetPlaybackFlags(assetId);
    const { isJobGateEnabled } = await import("@/lib/jobs/gates");
    const { JOB_NAMES } = await import("@/lib/jobs/types");
    if (isJobGateEnabled(JOB_NAMES.WEB_TRANSCODING, true)) {
      await getWebTranscodingQueue().add(
        "webTranscoding",
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
  }

  if (row && lutChanged) {
    const storage = getStorageAdapter();
    const config = loadConfig();
    await storage.delete(thumbnailCacheKey(userId, assetId), { tier: "cache" });
    await storage.delete(photoWebPreviewCacheKey(userId, assetId), {
      tier: "cache",
    });
    await getThumbnailsQueue().add(
      "thumbnails",
      { userId, assetId },
      {
        jobId: `thumbnails-lut-${assetId}-${Date.now()}`,
        attempts: config.jobs.retry.attempts,
        backoff: {
          type: "exponential",
          delay: config.jobs.retry.backoffMs,
        },
      },
    );
  }

  return row ?? null;
}

export async function bulkUpdateOwnedAssets(
  userId: string,
  assetIds: string[],
  input: {
    favorite?: boolean;
    isPublic?: boolean;
    softDelete?: boolean;
  },
) {
  if (assetIds.length === 0) return { updated: 0 };

  const db = getWebDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.favorite !== undefined) set.favorite = input.favorite;
  if (input.isPublic !== undefined) set.isPublic = input.isPublic;
  if (input.softDelete) set.deletedAt = new Date();

  const result = await db
    .update(assets)
    .set(set)
    .where(
      and(
        eq(assets.userId, userId),
        inArray(assets.id, assetIds),
        isNull(assets.deletedAt),
      ),
    )
    .returning({ id: assets.id, flightId: assets.flightId });

  if (input.softDelete && result.length > 0) {
    await binContentHashesForAssets(result.map((row) => row.id));
    await afterAssetsSoftDeleted(
      userId,
      result.map((row) => row.id),
      result.map((row) => row.flightId),
    );
  }

  return { updated: result.length };
}

export type LargeFileDto = {
  id: string;
  displayName: string;
  assetType: "photo" | "video" | "sequence";
  mainFileExt: string;
  fileSizeBytes: number | null;
  favorite: boolean;
  hasSrt: boolean;
  hasLrf: boolean;
  capturedAt: string;
  createdAt: string;
};

export async function listLargeFilesForUser(
  userId: string,
  limit = 100,
): Promise<LargeFileDto[]> {
  const db = getWebDb();
  const rows = await db
    .select({
      id: assets.id,
      displayName: assets.displayName,
      assetType: assets.assetType,
      mainFileExt: assets.mainFileExt,
      fileSizeBytes: assets.fileSizeBytes,
      favorite: assets.favorite,
      hasSrt: assets.hasSrt,
      hasLrf: assets.hasLrf,
      capturedAtOriginal: assets.capturedAtOriginal,
      capturedAtOverride: assets.capturedAtOverride,
      createdAt: assets.createdAt,
    })
    .from(assets)
    .where(and(eq(assets.userId, userId), isNull(assets.deletedAt)))
    .orderBy(sql`${assets.fileSizeBytes} desc nulls last`)
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    assetType: row.assetType,
    mainFileExt: row.mainFileExt,
    fileSizeBytes: row.fileSizeBytes,
    favorite: row.favorite,
    hasSrt: row.hasSrt,
    hasLrf: row.hasLrf,
    capturedAt: getEffectiveCaptureDate(row).toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function listLocatedAssetsForUser(userId: string, limit = 200) {
  const db = getWebDb();
  return db
    .select({
      id: assets.id,
      displayName: assets.displayName,
      assetType: assets.assetType,
      lat: sql<number | null>`ST_Y(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
      lng: sql<number | null>`ST_X(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
      hasOverride: sql<boolean>`${assets.locationOverride} is not null`,
    })
    .from(assets)
    .where(
      and(
        eq(assets.userId, userId),
        isNull(assets.deletedAt),
        sql`coalesce(${assets.locationOverride}, ${assets.locationOriginal}) is not null`,
      ),
    )
    .orderBy(assets.displayName)
    .limit(limit);
}

export type DuplicateAssetDto = {
  id: string;
  displayName: string;
  assetType: "photo" | "video" | "sequence";
  fileSizeBytes: number | null;
};

export type DuplicateGroupDto = {
  hash: string;
  assets: DuplicateAssetDto[];
  /** @deprecated keep for older clients */
  assetIds: string[];
  /** @deprecated keep for older clients */
  displayNames: string[];
};

export async function listNearDuplicateCandidates(userId: string, limit = 100) {
  const db = getWebDb();

  const hashed = await db
    .select({
      contentHash: assets.contentHash,
      id: assets.id,
      displayName: assets.displayName,
      assetType: assets.assetType,
      fileSizeBytes: assets.fileSizeBytes,
    })
    .from(assets)
    .where(
      and(
        eq(assets.userId, userId),
        isNull(assets.deletedAt),
        sql`${assets.contentHash} is not null`,
      ),
    );

  const exactMap = new Map<string, DuplicateAssetDto[]>();
  for (const row of hashed) {
    if (!row.contentHash) continue;
    const entry = exactMap.get(row.contentHash) ?? [];
    entry.push({
      id: row.id,
      displayName: row.displayName,
      assetType: row.assetType,
      fileSizeBytes: row.fileSizeBytes,
    });
    exactMap.set(row.contentHash, entry);
  }

  const photos = await db
    .select({
      perceptualHash: assets.perceptualHash,
      id: assets.id,
      displayName: assets.displayName,
      assetType: assets.assetType,
      fileSizeBytes: assets.fileSizeBytes,
    })
    .from(assets)
    .where(
      and(
        eq(assets.userId, userId),
        isNull(assets.deletedAt),
        eq(assets.assetType, "photo"),
        sql`${assets.perceptualHash} is not null`,
      ),
    );

  const phashExact = new Map<string, DuplicateAssetDto[]>();
  for (const row of photos) {
    if (!row.perceptualHash) continue;
    const entry = phashExact.get(row.perceptualHash) ?? [];
    entry.push({
      id: row.id,
      displayName: row.displayName,
      assetType: row.assetType,
      fileSizeBytes: row.fileSizeBytes,
    });
    phashExact.set(row.perceptualHash, entry);
  }

  const nearGroups = clusterByHammingDistance(
    photos
      .filter((row): row is typeof row & { perceptualHash: string } =>
        Boolean(row.perceptualHash),
      )
      .map((row) => ({
        hash: row.perceptualHash,
        asset: {
          id: row.id,
          displayName: row.displayName,
          assetType: row.assetType,
          fileSizeBytes: row.fileSizeBytes,
        },
      })),
    8,
    limit,
  );

  function toGroups(
    map: Map<string, DuplicateAssetDto[]>,
  ): DuplicateGroupDto[] {
    return [...map.entries()]
      .filter(([, groupAssets]) => groupAssets.length > 1)
      .slice(0, limit)
      .map(([hash, groupAssets]) => ({
        hash,
        assets: groupAssets,
        assetIds: groupAssets.map((asset) => asset.id),
        displayNames: groupAssets.map((asset) => asset.displayName),
      }));
  }

  return {
    exactHash: toGroups(exactMap),
    perceptualHash:
      nearGroups.length > 0 ? nearGroups : toGroups(phashExact),
  };
}

function hammingHex(a: string, b: string) {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = Number.parseInt(a[i]!, 16) ^ Number.parseInt(b[i]!, 16);
    distance += (x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1);
  }
  return distance;
}

function clusterByHammingDistance(
  items: Array<{ hash: string; asset: DuplicateAssetDto }>,
  maxDistance: number,
  limit: number,
): DuplicateGroupDto[] {
  const used = new Set<string>();
  const groups: DuplicateGroupDto[] = [];

  for (let i = 0; i < items.length && groups.length < limit; i += 1) {
    const seed = items[i]!;
    if (used.has(seed.asset.id)) continue;
    const members = [seed.asset];
    used.add(seed.asset.id);

    for (let j = i + 1; j < items.length; j += 1) {
      const candidate = items[j]!;
      if (used.has(candidate.asset.id)) continue;
      if (hammingHex(seed.hash, candidate.hash) <= maxDistance) {
        members.push(candidate.asset);
        used.add(candidate.asset.id);
      }
    }

    if (members.length > 1) {
      groups.push({
        hash: `${seed.hash}~d${maxDistance}`,
        assets: members,
        assetIds: members.map((asset) => asset.id),
        displayNames: members.map((asset) => asset.displayName),
      });
    }
  }

  return groups;
}
