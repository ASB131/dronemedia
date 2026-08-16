import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";

import { getAccessibleAsset } from "@/lib/assets/access";
import type { AssetType } from "@/lib/assets/asset-type";
import { getWebDb } from "@/lib/db";
import {
  assetFiles,
  assets,
  drones,
  flightTelemetry,
  flights,
  luts,
  sequenceFrames,
} from "@/lib/db/schema";
import { getStorageAdapter } from "@/lib/storage";
import { sequenceFullResExportKey } from "./transcoding";
import type { MediaMetadata } from "./media-metadata";
import {
  effectivePanoramaViewer,
  isEquirectViewerMode,
} from "./panorama-viewer-mode";
import { panoramaHasLargeImage } from "./panorama-web-preview";
import { ensurePanoramaPoseHeading } from "./panorama-pose-heading";
import {
  getCaptureLocalParts,
  getCaptureTimezone,
  getEffectiveCaptureDate,
} from "./capture";

export type AssetNeighborDto = {
  id: string;
  displayName: string;
};

export type AssetNeighborsDto = {
  previous: AssetNeighborDto | null;
  next: AssetNeighborDto | null;
};

export type AssetFileDto = {
  extension: string;
  fileSizeBytes: number;
};

export type AssetTelemetrySummary = {
  parseStatus: string;
  maxAltitudeMeters: number | null;
  totalDistanceMeters: number | null;
  flightDurationSeconds: number | null;
  hasFlightPath: boolean;
};

export type AssetLocationDto = {
  lat: number;
  lng: number;
};

export type SequenceFrameDto = {
  id: string;
  frameIndex: number;
  filename: string;
  fileSizeBytes: number;
  capturedAt: string | null;
};

export type AssetDetailDto = {
  id: string;
  displayName: string;
  assetType: AssetType;
  favorite: boolean;
  isPublic: boolean;
  description: string | null;
  tags: string[];
  capturedAt: string;
  capturedTimezone: string;
  capturedLabel: string;
  mainFileExt: string;
  hasSrt: boolean;
  hasLrf: boolean;
  fileSizeBytes: number | null;
  files: AssetFileDto[];
  location: AssetLocationDto | null;
  mediaMetadata: MediaMetadata | null;
  hasHls: boolean;
  hasProxy: boolean;
  hasFullResExport: boolean;
  hasPanoPreview: boolean;
  sequenceKind: "hyperlapse" | "panorama" | null;
  frameCount: number | null;
  sequenceFolder: string | null;
  sequenceFps: number | null;
  sequenceFrames: SequenceFrameDto[];
  telemetry: AssetTelemetrySummary | null;
  droneId: string | null;
  droneName: string | null;
  flightId: string | null;
  flightTitle: string | null;
  preferredLutId: string | null;
  preferredLutName: string | null;
  /** ABR rung folders present in the HLS package (e.g. 720, 1080). */
  hlsHeightsPresent: number[];
  /** Admin-enabled heights missing from this asset's HLS package. */
  hlsHeightsMissing: number[];
};

export async function getAssetDetailForUser(
  userId: string,
  assetId: string,
): Promise<AssetDetailDto | null> {
  const accessible = await getAccessibleAsset(userId, assetId);
  if (!accessible) return null;

  const db = getWebDb();
  const [asset] = await db
    .select({
      id: assets.id,
      ownerUserId: assets.userId,
      displayName: assets.displayName,
      assetType: assets.assetType,
      favorite: assets.favorite,
      isPublic: assets.isPublic,
      description: assets.description,
      tags: assets.tags,
      capturedAtOriginal: assets.capturedAtOriginal,
      capturedAtOverride: assets.capturedAtOverride,
      capturedTimezone: assets.capturedTimezone,
      createdAt: assets.createdAt,
      mainFileExt: assets.mainFileExt,
      hasSrt: assets.hasSrt,
      hasLrf: assets.hasLrf,
      hasProxy: assets.hasProxy,
      hasHls: assets.hasHls,
      fileSizeBytes: assets.fileSizeBytes,
      mediaMetadata: assets.mediaMetadata,
      sequenceKind: assets.sequenceKind,
      frameCount: assets.frameCount,
      sequenceFolder: assets.sequenceFolder,
      sequenceFps: assets.sequenceFps,
      droneId: assets.droneId,
      droneName: drones.name,
      flightId: assets.flightId,
      flightTitle: flights.title,
      preferredLutId: assets.preferredLutId,
      preferredLutName: luts.name,
      lat: sql<number | null>`ST_Y(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
      lng: sql<number | null>`ST_X(coalesce(${assets.locationOverride}, ${assets.locationOriginal}))`,
    })
    .from(assets)
    .leftJoin(drones, eq(drones.id, assets.droneId))
    .leftJoin(flights, eq(flights.id, assets.flightId))
    .leftJoin(luts, eq(luts.id, assets.preferredLutId))
    .where(eq(assets.id, assetId))
    .limit(1);

  if (!asset) return null;

  const files = await db
    .select({
      extension: assetFiles.extension,
      fileSizeBytes: assetFiles.fileSizeBytes,
    })
    .from(assetFiles)
    .where(eq(assetFiles.assetId, assetId));

  const frameRows =
    asset.assetType === "sequence"
      ? await db
          .select({
            id: sequenceFrames.id,
            frameIndex: sequenceFrames.frameIndex,
            filename: sequenceFrames.filename,
            fileSizeBytes: sequenceFrames.fileSizeBytes,
            capturedAt: sequenceFrames.capturedAt,
          })
          .from(sequenceFrames)
          .where(eq(sequenceFrames.assetId, assetId))
          .orderBy(asc(sequenceFrames.frameIndex))
      : [];

  const [telemetry] = await db
    .select({
      parseStatus: flightTelemetry.parseStatus,
      maxAltitudeMeters: flightTelemetry.maxAltitudeMeters,
      totalDistanceMeters: flightTelemetry.totalDistanceMeters,
      flightDurationSeconds: flightTelemetry.flightDurationSeconds,
      flightPath: flightTelemetry.flightPath,
    })
    .from(flightTelemetry)
    .where(eq(flightTelemetry.assetId, assetId))
    .limit(1);

  const capturedAt = getEffectiveCaptureDate(asset);
  const tz = getCaptureTimezone(asset);
  const local = getCaptureLocalParts(capturedAt, tz);

  const hasCoords =
    typeof asset.lat === "number" &&
    typeof asset.lng === "number" &&
    Number.isFinite(asset.lat) &&
    Number.isFinite(asset.lng);

  let hasHls = asset.hasHls;
  let hasProxy = asset.hasProxy || asset.hasLrf;
  let hasFullResExport = false;
  let hasPanoPreview = false;
  let hlsHeightsPresent: number[] = [];
  let hlsHeightsMissing: number[] = [];
  if (asset.assetType === "video" || asset.assetType === "sequence") {
    const storage = getStorageAdapter();
    if (asset.sequenceKind === "panorama") {
      hasPanoPreview = await panoramaHasLargeImage(
        asset.ownerUserId,
        assetId,
      );
    } else {
      // Prefer live cache presence over stale DB flags (flags can lag after migrate).
      const { videoHlsPlaylistKey, videoHlsVariantPrefix } = await import(
        "./hls"
      );
      const { videoProxyCacheKey } = await import("./transcoding");
      const { loadConfig } = await import("@/lib/config");
      const { normalizeHlsPreviewHeights } = await import(
        "@/lib/playback/resolution"
      );
      const { parseHlsMasterHeights } = await import(
        "@/lib/admin/hls-preview-cleanup"
      );
      const [hlsExists, proxyExists] = await Promise.all([
        storage.exists(videoHlsPlaylistKey(asset.ownerUserId, assetId), {
          tier: "cache",
        }),
        storage.exists(videoProxyCacheKey(asset.ownerUserId, assetId), {
          tier: "cache",
        }),
      ]);
      hasHls = hlsExists;
      hasProxy = proxyExists || asset.hasLrf;
      if (hasHls !== asset.hasHls || hasProxy !== (asset.hasProxy || asset.hasLrf)) {
        const { setAssetPlaybackFlags } = await import("./playback-flags");
        void setAssetPlaybackFlags(assetId, { hasHls, hasProxy });
      }
      const enabled = normalizeHlsPreviewHeights(
        loadConfig().transcoding.hls.heights,
      );
      if (hlsExists) {
        const raw = await storage.get(
          videoHlsPlaylistKey(asset.ownerUserId, assetId),
          { tier: "cache" },
        );
        if (raw) {
          hlsHeightsPresent = parseHlsMasterHeights(
            Buffer.from(raw).toString("utf8"),
          );
        }
        // Also trust on-disk variant folders if master is incomplete.
        const fromDisk: number[] = [];
        for (const height of enabled) {
          const exists = await storage.exists(
            `${videoHlsVariantPrefix(asset.ownerUserId, assetId, height)}/index.m3u8`,
            { tier: "cache" },
          );
          if (exists) fromDisk.push(height);
        }
        if (fromDisk.length > 0) {
          hlsHeightsPresent = [
            ...new Set([...hlsHeightsPresent, ...fromDisk]),
          ].sort((a, b) => a - b);
        }
      }
      const presentSet = new Set(hlsHeightsPresent);
      hlsHeightsMissing = enabled.filter((height) => !presentSet.has(height));
      if (asset.assetType === "sequence") {
        hasFullResExport = await storage.exists(
          sequenceFullResExportKey(asset.ownerUserId, assetId),
          { tier: "cache" },
        );
      }
    }
  } else if (
    asset.assetType === "photo" &&
    isEquirectViewerMode(
      effectivePanoramaViewer({
        assetType: asset.assetType,
        sequenceKind: asset.sequenceKind,
        mediaMetadata: asset.mediaMetadata,
      }),
    )
  ) {
    // Standalone stitch photos are ready as soon as the main file exists.
    hasPanoPreview = true;
  }

  let mediaMetadata = asset.mediaMetadata ?? null;
  // Backfill heading for panos and any still that may carry DJI/EXIF yaw.
  const isHeadingCandidate =
    asset.sequenceKind === "panorama" || asset.assetType === "photo";
  if (isHeadingCandidate) {
    mediaMetadata = await ensurePanoramaPoseHeading(
      asset.ownerUserId,
      assetId,
      mediaMetadata,
      { mainFileExt: asset.mainFileExt },
    );
  }

  return {
    id: asset.id,
    displayName: asset.displayName,
    assetType: asset.assetType,
    favorite: asset.favorite,
    isPublic: asset.isPublic,
    description: asset.description,
    tags: asset.tags,
    capturedAt: capturedAt.toISOString(),
    capturedTimezone: tz,
    capturedLabel: local.dateLabel,
    mainFileExt: asset.mainFileExt,
    hasSrt: asset.hasSrt,
    hasLrf: asset.hasLrf,
    fileSizeBytes: asset.fileSizeBytes,
    files: files.map((file) => ({
      extension: file.extension,
      fileSizeBytes: file.fileSizeBytes,
    })),
    location: hasCoords ? { lat: asset.lat!, lng: asset.lng! } : null,
    mediaMetadata,
    hasHls,
    hasProxy,
    hasFullResExport,
    hasPanoPreview,
    sequenceKind: asset.sequenceKind ?? null,
    frameCount: asset.frameCount ?? null,
    sequenceFolder: asset.sequenceFolder ?? null,
    sequenceFps:
      typeof asset.sequenceFps === "number" && Number.isFinite(asset.sequenceFps)
        ? asset.sequenceFps
        : null,
    sequenceFrames: frameRows.map((frame) => ({
      id: frame.id,
      frameIndex: frame.frameIndex,
      filename: frame.filename,
      fileSizeBytes: frame.fileSizeBytes,
      capturedAt: frame.capturedAt?.toISOString() ?? null,
    })),
    droneId: asset.droneId,
    droneName: asset.droneName ?? null,
    flightId: asset.flightId,
    flightTitle: asset.flightTitle ?? null,
    preferredLutId: asset.preferredLutId ?? null,
    preferredLutName: asset.preferredLutName ?? null,
    hlsHeightsPresent,
    hlsHeightsMissing,
    telemetry: telemetry
      ? {
          parseStatus: telemetry.parseStatus,
          maxAltitudeMeters: telemetry.maxAltitudeMeters
            ? Number(telemetry.maxAltitudeMeters)
            : null,
          totalDistanceMeters: telemetry.totalDistanceMeters
            ? Number(telemetry.totalDistanceMeters)
            : null,
          flightDurationSeconds: telemetry.flightDurationSeconds
            ? Number(telemetry.flightDurationSeconds)
            : null,
          hasFlightPath: Boolean(telemetry.flightPath),
        }
      : null,
  };
}

/** Previous/next library neighbors ordered by capture time (then id). */
export async function getAssetNeighborsForUser(
  userId: string,
  assetId: string,
): Promise<AssetNeighborsDto | null> {
  const detail = await getAssetDetailForUser(userId, assetId);
  if (!detail) return null;

  const db = getWebDb();
  const capturedAt = new Date(detail.capturedAt);
  const captureExpr = sql`coalesce(${assets.capturedAtOverride}, ${assets.capturedAtOriginal}, ${assets.createdAt})`;

  const [previous] = await db
    .select({
      id: assets.id,
      displayName: assets.displayName,
    })
    .from(assets)
    .where(
      and(
        eq(assets.userId, userId),
        isNull(assets.deletedAt),
        or(
          sql`${captureExpr} < ${capturedAt}`,
          sql`(${captureExpr} = ${capturedAt} AND ${assets.id} < ${assetId})`,
        ),
      ),
    )
    .orderBy(desc(captureExpr), desc(assets.id))
    .limit(1);

  const [next] = await db
    .select({
      id: assets.id,
      displayName: assets.displayName,
    })
    .from(assets)
    .where(
      and(
        eq(assets.userId, userId),
        isNull(assets.deletedAt),
        or(
          sql`${captureExpr} > ${capturedAt}`,
          sql`(${captureExpr} = ${capturedAt} AND ${assets.id} > ${assetId})`,
        ),
      ),
    )
    .orderBy(asc(captureExpr), asc(assets.id))
    .limit(1);

  return {
    previous: previous ?? null,
    next: next ?? null,
  };
}
