import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { videoHlsPrefix } from "@/lib/assets/hls";
import {
  refreshAssetPlaybackFlags,
} from "@/lib/assets/playback-flags";
import { thumbnailCacheKey } from "@/lib/assets/thumbnails";
import { videoProxyCacheKey } from "@/lib/assets/transcoding";
import { loadConfig } from "@/lib/config";
import { getWorkerDb } from "@/lib/db";
import {
  assetFiles,
  assets,
  flightTelemetry,
  telemetryPoints,
  users,
  videoChapters,
} from "@/lib/db/schema";
import { enqueueAssetRefresh } from "@/lib/jobs/refresh-asset";
import { getSrtFlightPathQueue } from "@/lib/jobs/queues";
import { deleteFlightIfNoAssets } from "@/lib/library/orphan-cleanup";
import { refreshFlightStats } from "@/lib/flights/queries";
import { buildMediaAssetKey, getStorageAdapter } from "@/lib/storage";
import { clearFalseDuplicateFlags } from "@/lib/assets/duplicate-flags";

const execFileAsync = promisify(execFile);
const DURATION_GAP_SECONDS = 0.2;

export type SidecarRepairAction = {
  assetId: string;
  displayName: string;
  keepSrt: boolean;
  keepLrf: boolean;
  detachSrt: boolean;
  detachLrf: boolean;
  reason: string;
};

export type SidecarRepairGroup = {
  stem: string;
  ownerAssetId: string | null;
  reason: string;
  actions: SidecarRepairAction[];
};

async function probeDurationSeconds(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { timeout: 60_000 },
    );
    const n = Number.parseFloat(stdout.trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function mediaFilePath(userId: string, assetId: string, extension: string) {
  const config = loadConfig();
  const key = buildMediaAssetKey(userId, assetId, extension);
  return path.join(config.storage.mediaPath, ...key.split("/"));
}

function pickOwnerByDuration(
  members: Array<{ id: string; mp4Duration: number | null }>,
  lrfDuration: number | null,
): { ownerId: string | null; reason: string } {
  if (lrfDuration == null) {
    return { ownerId: null, reason: "no LRF duration" };
  }
  const scored = members
    .filter((m) => m.mp4Duration != null)
    .map((m) => ({
      id: m.id,
      delta: Math.abs((m.mp4Duration as number) - lrfDuration),
    }))
    .sort((a, b) => a.delta - b.delta);
  if (scored.length === 0) {
    return { ownerId: null, reason: "no MP4 durations" };
  }
  const best = scored[0]!;
  const second = scored[1];
  if (
    second &&
    second.delta - best.delta < DURATION_GAP_SECONDS &&
    best.delta > 0.05
  ) {
    return {
      ownerId: null,
      reason: `ambiguous LRF duration (best Δ${best.delta.toFixed(3)}s vs ${second.delta.toFixed(3)}s)`,
    };
  }
  return {
    ownerId: best.id,
    reason: `LRF duration matches MP4 (Δ${best.delta.toFixed(3)}s)`,
  };
}

async function detachExtension(params: {
  userId: string;
  assetId: string;
  extension: "srt" | "lrf";
}): Promise<number> {
  const db = getWorkerDb();
  const storage = getStorageAdapter();
  const [row] = await db
    .select()
    .from(assetFiles)
    .where(
      and(
        eq(assetFiles.assetId, params.assetId),
        eq(assetFiles.extension, params.extension),
      ),
    )
    .limit(1);
  if (!row) return 0;

  const key = buildMediaAssetKey(params.userId, params.assetId, params.extension);
  await storage.delete(key, { tier: "media" }).catch(() => undefined);
  await db
    .delete(assetFiles)
    .where(eq(assetFiles.id, row.id));
  return row.fileSizeBytes ?? 0;
}

async function stripSrtDerivedMetadata(assetId: string, flightId: string | null) {
  const db = getWorkerDb();
  await db.delete(telemetryPoints).where(eq(telemetryPoints.assetId, assetId));
  await db.delete(flightTelemetry).where(eq(flightTelemetry.assetId, assetId));
  await db
    .delete(videoChapters)
    .where(
      and(eq(videoChapters.assetId, assetId), eq(videoChapters.source, "auto")),
    );
  await db
    .update(assets)
    .set({
      hasSrt: false,
      flightId: null,
      locationOriginal: null,
      capturedAtOriginal: null,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, assetId));
  if (flightId) {
    await refreshFlightStats(db, flightId);
    await deleteFlightIfNoAssets(db, flightId);
  }
}

async function requeueThumbAndMetadata(params: {
  userId: string;
  assetId: string;
  displayName: string;
}) {
  const storage = getStorageAdapter();
  await storage
    .delete(thumbnailCacheKey(params.userId, params.assetId), { tier: "cache" })
    .catch(() => undefined);
  await enqueueAssetRefresh({
    userId: params.userId,
    assetId: params.assetId,
    assetName: params.displayName,
    options: { thumbnails: true, metadata: true, dedup: false },
  });
}

export async function planCrossAttachedSidecarRepairs(): Promise<{
  groups: SidecarRepairGroup[];
}> {
  const db = getWorkerDb();
  const videos = await db
    .select({
      id: assets.id,
      userId: assets.userId,
      displayName: assets.displayName,
      contentHash: assets.contentHash,
      mainFileExt: assets.mainFileExt,
      hasSrt: assets.hasSrt,
      hasLrf: assets.hasLrf,
    })
    .from(assets)
    .where(and(isNull(assets.deletedAt), eq(assets.assetType, "video")));

  const stemOf = (name: string) =>
    name.replace(/\.[^.]+$/, "").toLowerCase();

  const byStem = new Map<string, typeof videos>();
  for (const row of videos) {
    const stem = stemOf(row.displayName);
    const list = byStem.get(stem) ?? [];
    list.push(row);
    byStem.set(stem, list);
  }

  const groups: SidecarRepairGroup[] = [];

  for (const [stem, members] of byStem) {
    const hashes = new Set(members.map((m) => m.contentHash).filter(Boolean));
    if (members.length < 2 || hashes.size < 2) continue;

    const ids = members.map((m) => m.id);
    const files = await db
      .select({
        assetId: assetFiles.assetId,
        extension: assetFiles.extension,
        contentHash: assetFiles.contentHash,
      })
      .from(assetFiles)
      .where(
        and(
          inArray(assetFiles.assetId, ids),
          inArray(assetFiles.extension, ["srt", "lrf", "mp4"]),
        ),
      );

    const srtHashes = new Set(
      files.filter((f) => f.extension === "srt").map((f) => f.contentHash),
    );
    const lrfHashes = new Set(
      files.filter((f) => f.extension === "lrf").map((f) => f.contentHash),
    );
    const sharedSidecar =
      srtHashes.size === 1 &&
      files.filter((f) => f.extension === "srt").length > 1 ||
      (lrfHashes.size === 1 &&
        files.filter((f) => f.extension === "lrf").length > 1);

    const anySidecar = files.some(
      (f) => f.extension === "srt" || f.extension === "lrf",
    );
    if (!anySidecar) {
      groups.push({
        stem,
        ownerAssetId: null,
        reason: "same name, different MP4s, no SRT/LRF — no sidecar change",
        actions: members.map((m) => ({
          assetId: m.id,
          displayName: m.displayName,
          keepSrt: false,
          keepLrf: false,
          detachSrt: false,
          detachLrf: false,
          reason: "no sidecars",
        })),
      });
      continue;
    }

    const withDur = [];
    let lrfDuration: number | null = null;
    for (const m of members) {
      const mp4Path = mediaFilePath(m.userId, m.id, m.mainFileExt || "mp4");
      const lrfPath = mediaFilePath(m.userId, m.id, "lrf");
      const mp4Duration = await probeDurationSeconds(mp4Path);
      const thisLrf = await probeDurationSeconds(lrfPath);
      if (thisLrf != null) lrfDuration = thisLrf;
      withDur.push({ id: m.id, mp4Duration });
    }

    const picked = pickOwnerByDuration(withDur, lrfDuration);
    let ownerId = picked.ownerId;
    let reason = picked.reason;

    if (!ownerId && !sharedSidecar) {
      const uniqueSrt = members.filter((m) =>
        files.some((f) => f.assetId === m.id && f.extension === "srt"),
      );
      if (uniqueSrt.length === 1) {
        ownerId = uniqueSrt[0]!.id;
        reason = "only one asset has SRT";
      }
    }

    const actions: SidecarRepairAction[] = members.map((m) => {
      const hasSrt = files.some(
        (f) => f.assetId === m.id && f.extension === "srt",
      );
      const hasLrf = files.some(
        (f) => f.assetId === m.id && f.extension === "lrf",
      );
      const isOwner = ownerId === m.id;
      if (!ownerId) {
        return {
          assetId: m.id,
          displayName: m.displayName,
          keepSrt: false,
          keepLrf: false,
          detachSrt: hasSrt,
          detachLrf: hasLrf,
          reason: `ambiguous — detach all (${reason})`,
        };
      }
      return {
        assetId: m.id,
        displayName: m.displayName,
        keepSrt: isOwner && hasSrt,
        keepLrf: isOwner && hasLrf,
        detachSrt: !isOwner && hasSrt,
        detachLrf: !isOwner && hasLrf,
        reason: isOwner ? `keep sidecars (${reason})` : `detach sidecars (${reason})`,
      };
    });

    groups.push({ stem, ownerAssetId: ownerId, reason, actions });
  }

  return { groups };
}

export async function applyCrossAttachedSidecarRepairs(params?: {
  userId?: string;
}): Promise<{
  groups: SidecarRepairGroup[];
  detached: number;
  thumbsQueued: number;
  srtQueued: number;
  flagsCleared: number;
}> {
  const db = getWorkerDb();
  const storage = getStorageAdapter();
  const { groups } = await planCrossAttachedSidecarRepairs();
  const config = loadConfig();
  const retry = {
    attempts: config.jobs.retry.attempts,
    backoff: {
      type: "exponential" as const,
      delay: config.jobs.retry.backoffMs,
    },
  };

  let detached = 0;
  let thumbsQueued = 0;
  let srtQueued = 0;
  const touchedUserIds = new Set<string>();
  const touchedAssetIds = new Set<string>();

  for (const group of groups) {
    for (const action of group.actions) {
      if (!action.detachSrt && !action.detachLrf) continue;
      const [asset] = await db
        .select()
        .from(assets)
        .where(eq(assets.id, action.assetId))
        .limit(1);
      if (!asset) continue;
      if (params?.userId && asset.userId !== params.userId) continue;

      let removedBytes = 0;
      if (action.detachSrt) {
        removedBytes += await detachExtension({
          userId: asset.userId,
          assetId: asset.id,
          extension: "srt",
        });
        await stripSrtDerivedMetadata(asset.id, asset.flightId);
        detached += 1;
      }
      if (action.detachLrf) {
        removedBytes += await detachExtension({
          userId: asset.userId,
          assetId: asset.id,
          extension: "lrf",
        });
        await storage
          .delete(videoProxyCacheKey(asset.userId, asset.id), { tier: "cache" })
          .catch(() => undefined);
        await storage
          .deletePrefix(videoHlsPrefix(asset.userId, asset.id), {
            tier: "cache",
          })
          .catch(() => undefined);
        await db
          .update(assets)
          .set({ hasLrf: false, updatedAt: new Date() })
          .where(eq(assets.id, asset.id));
        await refreshAssetPlaybackFlags(asset.userId, asset.id, {
          hasLrf: false,
        });
        detached += 1;
      }

      if (removedBytes !== 0) {
        await db
          .update(assets)
          .set({
            fileSizeBytes: sql`greatest(0, coalesce(${assets.fileSizeBytes}, 0) - ${removedBytes})`,
            updatedAt: new Date(),
          })
          .where(eq(assets.id, asset.id));
        await db
          .update(users)
          .set({
            storageUsedBytes: sql`greatest(0, ${users.storageUsedBytes} - ${removedBytes})`,
            updatedAt: new Date(),
          })
          .where(eq(users.id, asset.userId));
      }

      await storage
        .delete(thumbnailCacheKey(asset.userId, asset.id), { tier: "cache" })
        .catch(() => undefined);
      await enqueueAssetRefresh({
        userId: asset.userId,
        assetId: asset.id,
        assetName: asset.displayName,
        options: { thumbnails: true, metadata: true, dedup: false },
      });
      thumbsQueued += 1;
      touchedUserIds.add(asset.userId);
      touchedAssetIds.add(asset.id);
    }

    if (group.ownerAssetId) {
      const [owner] = await db
        .select()
        .from(assets)
        .where(eq(assets.id, group.ownerAssetId))
        .limit(1);
      if (owner?.hasSrt) {
        await getSrtFlightPathQueue().add(
          "srtFlightPath",
          { userId: owner.userId, assetId: owner.id },
          retry,
        );
        srtQueued += 1;
      }
      if (owner && !touchedAssetIds.has(owner.id)) {
        await storage
          .delete(thumbnailCacheKey(owner.userId, owner.id), { tier: "cache" })
          .catch(() => undefined);
        await enqueueAssetRefresh({
          userId: owner.userId,
          assetId: owner.id,
          assetName: owner.displayName,
          options: { thumbnails: true, metadata: false, dedup: false },
        });
        thumbsQueued += 1;
      }
    }
  }

  let flagsCleared = 0;
  for (const userId of touchedUserIds) {
    const result = await clearFalseDuplicateFlags(userId);
    flagsCleared += result.cleared;
  }

  return { groups, detached, thumbsQueued, srtQueued, flagsCleared };
}

const LRF_MISMATCH_SECONDS = 0.5;

/**
 * Detach LRF (and SRT) when LRF duration does not match the MP4, then clear
 * leftover SRT GPS on videos that no longer have an SRT file.
 */
export async function applyLeftoverSidecarRepairs(): Promise<{
  mismatched: Array<{
    assetId: string;
    displayName: string;
    mp4Duration: number;
    lrfDuration: number;
  }>;
  locationsCleared: number;
  thumbsQueued: number;
}> {
  const db = getWorkerDb();
  const storage = getStorageAdapter();
  const videos = await db
    .select()
    .from(assets)
    .where(and(isNull(assets.deletedAt), eq(assets.assetType, "video")));

  const mismatched: Array<{
    assetId: string;
    displayName: string;
    mp4Duration: number;
    lrfDuration: number;
  }> = [];
  let thumbsQueued = 0;

  for (const asset of videos) {
    if (!asset.hasLrf) continue;
    const mp4Path = mediaFilePath(asset.userId, asset.id, asset.mainFileExt);
    const lrfPath = mediaFilePath(asset.userId, asset.id, "lrf");
    const mp4Duration = await probeDurationSeconds(mp4Path);
    const lrfDuration = await probeDurationSeconds(lrfPath);
    if (mp4Duration == null || lrfDuration == null) continue;
    if (Math.abs(mp4Duration - lrfDuration) <= LRF_MISMATCH_SECONDS) continue;

    mismatched.push({
      assetId: asset.id,
      displayName: asset.displayName,
      mp4Duration,
      lrfDuration,
    });

    let removedBytes = 0;
    removedBytes += await detachExtension({
      userId: asset.userId,
      assetId: asset.id,
      extension: "lrf",
    });
    await storage
      .delete(videoProxyCacheKey(asset.userId, asset.id), { tier: "cache" })
      .catch(() => undefined);
    await storage
      .deletePrefix(videoHlsPrefix(asset.userId, asset.id), { tier: "cache" })
      .catch(() => undefined);
    await db
      .update(assets)
      .set({ hasLrf: false, updatedAt: new Date() })
      .where(eq(assets.id, asset.id));
    await refreshAssetPlaybackFlags(asset.userId, asset.id, { hasLrf: false });

    const [srtRow] = await db
      .select({ id: assetFiles.id })
      .from(assetFiles)
      .where(
        and(eq(assetFiles.assetId, asset.id), eq(assetFiles.extension, "srt")),
      )
      .limit(1);
    if (srtRow) {
      removedBytes += await detachExtension({
        userId: asset.userId,
        assetId: asset.id,
        extension: "srt",
      });
      await stripSrtDerivedMetadata(asset.id, asset.flightId);
    }

    if (removedBytes !== 0) {
      await db
        .update(assets)
        .set({
          fileSizeBytes: sql`greatest(0, coalesce(${assets.fileSizeBytes}, 0) - ${removedBytes})`,
          updatedAt: new Date(),
        })
        .where(eq(assets.id, asset.id));
      await db
        .update(users)
        .set({
          storageUsedBytes: sql`greatest(0, ${users.storageUsedBytes} - ${removedBytes})`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, asset.userId));
    }

    await requeueThumbAndMetadata({
      userId: asset.userId,
      assetId: asset.id,
      displayName: asset.displayName,
    });
    thumbsQueued += 1;
  }

  const leftover = await db
    .select({
      id: assets.id,
      userId: assets.userId,
      displayName: assets.displayName,
      flightId: assets.flightId,
    })
    .from(assets)
    .where(
      and(
        isNull(assets.deletedAt),
        eq(assets.assetType, "video"),
        sql`${assets.locationOriginal} is not null`,
      ),
    );

  let locationsCleared = 0;
  for (const row of leftover) {
    const [srtRow] = await db
      .select({ id: assetFiles.id })
      .from(assetFiles)
      .where(
        and(eq(assetFiles.assetId, row.id), eq(assetFiles.extension, "srt")),
      )
      .limit(1);
    if (srtRow) continue;
    await stripSrtDerivedMetadata(row.id, row.flightId);
    await requeueThumbAndMetadata({
      userId: row.userId,
      assetId: row.id,
      displayName: row.displayName,
    });
    locationsCleared += 1;
    thumbsQueued += 1;
  }

  return { mismatched, locationsCleared, thumbsQueued };
}
