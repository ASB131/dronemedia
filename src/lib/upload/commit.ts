import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { reclaimContentHashFromBin } from "@/lib/assets/content-hash-bin";
import {
  enqueuePanoramaRestitch,
  findDjiPhotoForCaptureIndex,
  findPanoramaForCaptureIndex,
  promoteStitchPhotoToPanoramaShell,
} from "@/lib/assets/panorama-dji";
import { videoHlsPrefix } from "@/lib/assets/hls";
import {
  panoramaDjiStitchedMediaKey,
  videoProxyCacheKey,
} from "@/lib/assets/transcoding";
import { loadConfig } from "@/lib/config";
import { getWebDb } from "@/lib/db";
import {
  assetFiles,
  assets,
  sequenceFrames,
  uploadBatches,
  uploadFiles,
  users,
} from "@/lib/db/schema";
import { hashFileStream } from "@/lib/hash";
import { contentHashMatches } from "@/lib/hash/match";
import { enqueueAssetPipeline } from "@/lib/jobs/enqueue";
import {
  getSrtFlightPathQueue,
  getWebTranscodingQueue,
} from "@/lib/jobs/queues";
import { getStorageAdapter, buildMediaAssetKey, buildSequenceFrameKey } from "@/lib/storage";
import { FAILED_UPLOAD_TTL_MS } from "@/lib/upload/ttl";
import {
  groupKeyForUploadFile,
  inferAssetType,
  isProxyExtension,
  isTelemetryExtension,
  isVideoExtension,
  normalizeBasename,
  pickMainDisplayName,
  pickMainExtension,
  primaryMediaGroupKey,
  uploadRelativeFolder,
} from "@/lib/upload/filename";
import {
  uploadAssembledKey,
  uploadStagingPrefix,
} from "@/lib/upload/paths";
import {
  isDjiStitchedPanoramaFilename,
  leafFilename,
  panoramaFolderCaptureIndex,
  parseDjiStitchedPanoramaFilename,
  parseHyperlapseFilename,
  parsePanoramaFilename,
  partitionHyperlapseSequences,
  partitionPanoramaSequences,
  sequenceDisplayName,
  sequenceFolderLabel,
  type SequenceKind,
} from "@/lib/upload/sequences";

type UploadFileRow = typeof uploadFiles.$inferSelect;

function isSidecarOnlyGroup(extensions: string[]) {
  return (
    extensions.length > 0 &&
    extensions.every(
      (ext) => isTelemetryExtension(ext) || isProxyExtension(ext),
    )
  );
}

async function sidecarHashOwnedByOtherAsset(params: {
  userId: string;
  contentHash: string;
  extension: string;
  exceptAssetId?: string;
}): Promise<string | null> {
  const db = getWebDb();
  const rows = await db
    .select({ assetId: assetFiles.assetId })
    .from(assetFiles)
    .innerJoin(assets, eq(assets.id, assetFiles.assetId))
    .where(
      and(
        eq(assetFiles.userId, params.userId),
        eq(assetFiles.extension, params.extension),
        eq(assetFiles.contentHash, params.contentHash),
        isNull(assets.deletedAt),
      ),
    )
    .limit(8);
  const other = rows.find((row) => row.assetId !== params.exceptAssetId);
  return other?.assetId ?? null;
}

async function findAssetForSidecarBasename(
  userId: string,
  basename: string,
): Promise<
  | { status: "none" }
  | { status: "unique"; asset: typeof assets.$inferSelect }
  | { status: "ambiguous"; count: number }
> {
  const db = getWebDb();
  const key = normalizeBasename(basename);
  const rows = await db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.userId, userId),
        sql`${assets.deletedAt} is null`,
        sql`lower(regexp_replace(${assets.displayName}, '\\.[^.]+$', '')) = ${key}`,
      ),
    )
    .limit(10);

  if (rows.length === 0) return { status: "none" };
  if (rows.length > 1) return { status: "ambiguous", count: rows.length };
  return { status: "unique", asset: rows[0]! };
}

async function attachAssembledDjiToPanorama(params: {
  userId: string;
  panoramaId: string;
  file: UploadFileRow;
  /** When false, caller already counted bytes on the panorama asset. */
  bumpFileSize?: boolean;
  /** When false, skip restitch (e.g. brand-new asset still in the pipeline). */
  restitch?: boolean;
}) {
  const {
    userId,
    panoramaId,
    file,
    bumpFileSize = true,
    restitch = true,
  } = params;
  const db = getWebDb();
  const storage = getStorageAdapter();
  const mediaKey = panoramaDjiStitchedMediaKey(userId, panoramaId);
  const assembledKey = uploadAssembledKey(userId, file.id);

  const [existing] = await db
    .select()
    .from(assetFiles)
    .where(
      and(
        eq(assetFiles.assetId, panoramaId),
        eq(assetFiles.extension, "dji-pano.jpg"),
      ),
    )
    .limit(1);

  if (file.contentHash) {
    await reclaimContentHashFromBin(userId, file.contentHash);
  }

  if (existing) {
    await storage.delete(mediaKey, { tier: "media" }).catch(() => undefined);
    await db
      .update(assetFiles)
      .set({
        contentHash: file.contentHash!,
        fileSizeBytes: file.fileSizeBytes,
      })
      .where(eq(assetFiles.id, existing.id));
  } else {
    await db.insert(assetFiles).values({
      assetId: panoramaId,
      userId,
      extension: "dji-pano.jpg",
      contentHash: file.contentHash!,
      fileSizeBytes: file.fileSizeBytes,
    });
  }

  await storage.move(assembledKey, mediaKey, {
    fromTier: "cache",
    toTier: "media",
  });

  await db
    .update(uploadFiles)
    .set({ assetId: panoramaId, updatedAt: new Date() })
    .where(eq(uploadFiles.id, file.id));

  await storage.deletePrefix(uploadStagingPrefix(userId, file.id), {
    tier: "cache",
  });

  if (bumpFileSize) {
    await db
      .update(assets)
      .set({
        fileSizeBytes: sql`coalesce(${assets.fileSizeBytes}, 0) + ${file.fileSizeBytes}`,
        updatedAt: new Date(),
      })
      .where(eq(assets.id, panoramaId));
  }

  if (restitch) {
    await enqueuePanoramaRestitch(userId, panoramaId);
  }
}

async function attachSidecarFiles(params: {
  userId: string;
  assetId: string;
  groupFiles: UploadFileRow[];
}) {
  const { userId, assetId, groupFiles } = params;
  const db = getWebDb();
  const config = loadConfig();
  const storage = getStorageAdapter();

  const [asset] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.userId, userId)))
    .limit(1);
  if (!asset) {
    throw new Error("Matching asset not found for sidecar upload");
  }

  let addedBytes = 0;
  let attachedSrt = false;
  let attachedLrf = false;

  for (const file of groupFiles) {
    if (
      (isTelemetryExtension(file.extension) ||
        isProxyExtension(file.extension)) &&
      file.contentHash
    ) {
      const other = await sidecarHashOwnedByOtherAsset({
        userId,
        contentHash: file.contentHash,
        extension: file.extension,
        exceptAssetId: assetId,
      });
      if (other) {
        console.warn(
          `[attachSidecarFiles] refused ${file.displayName} — hash already on asset ${other}`,
        );
        continue;
      }
    }
    const mediaKey = buildMediaAssetKey(userId, assetId, file.extension);
    const assembledKey = uploadAssembledKey(userId, file.id);

    const [existingFile] = await db
      .select()
      .from(assetFiles)
      .where(
        and(
          eq(assetFiles.assetId, assetId),
          eq(assetFiles.extension, file.extension),
        ),
      )
      .limit(1);

    if (existingFile) {
      await storage.delete(mediaKey, { tier: "media" });
      addedBytes += file.fileSizeBytes - existingFile.fileSizeBytes;
      await db
        .update(assetFiles)
        .set({
          contentHash: file.contentHash!,
          fileSizeBytes: file.fileSizeBytes,
        })
        .where(
          and(
            eq(assetFiles.assetId, assetId),
            eq(assetFiles.extension, file.extension),
          ),
        );
    } else {
      addedBytes += file.fileSizeBytes;
      await db.insert(assetFiles).values({
        assetId,
        userId,
        extension: file.extension,
        contentHash: file.contentHash!,
        fileSizeBytes: file.fileSizeBytes,
      });
    }

    await storage.move(assembledKey, mediaKey, {
      fromTier: "cache",
      toTier: "media",
    });

    await db
      .update(uploadFiles)
      .set({ assetId, updatedAt: new Date() })
      .where(eq(uploadFiles.id, file.id));

    await storage.deletePrefix(uploadStagingPrefix(userId, file.id), {
      tier: "cache",
    });

    if (isTelemetryExtension(file.extension)) attachedSrt = true;
    if (isProxyExtension(file.extension)) attachedLrf = true;
  }

  await db
    .update(assets)
    .set({
      hasSrt: asset.hasSrt || attachedSrt,
      hasLrf: asset.hasLrf || attachedLrf,
      fileSizeBytes: (asset.fileSizeBytes ?? 0) + addedBytes,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, assetId));

  if (addedBytes !== 0) {
    await db
      .update(users)
      .set({
        storageUsedBytes: sql`${users.storageUsedBytes} + ${addedBytes}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  const jobOpts = {
    attempts: config.jobs.retry.attempts,
    backoff: {
      type: "exponential" as const,
      delay: config.jobs.retry.backoffMs,
    },
  };

  if (attachedSrt) {
    await getSrtFlightPathQueue().add(
      "srtFlightPath",
      { userId, assetId },
      jobOpts,
    );
  }

  if (attachedLrf && isVideoExtension(asset.mainFileExt)) {
    // LRF becomes progressive proxy; drop stale cache proxy/HLS and rebuild HLS.
    await storage.delete(videoProxyCacheKey(userId, assetId), {
      tier: "cache",
    });
    await storage.deletePrefix(videoHlsPrefix(userId, assetId), {
      tier: "cache",
    });
    const { setAssetPlaybackFlags } = await import(
      "@/lib/assets/playback-flags"
    );
    await setAssetPlaybackFlags(assetId, { hasProxy: true, hasHls: false });
    const { isJobGateEnabled } = await import("@/lib/jobs/gates");
    const { JOB_NAMES } = await import("@/lib/jobs/types");
    if (isJobGateEnabled(JOB_NAMES.WEB_TRANSCODING, true)) {
      await getWebTranscodingQueue().add(
        "webTranscoding",
        { userId, assetId },
        jobOpts,
      );
    }
  }

  return { assetId, fileIds: groupFiles.map((file) => file.id) };
}

export async function commitUploadBatch(batchId: string, userId: string) {
  const db = getWebDb();
  const config = loadConfig();
  const storage = getStorageAdapter();

  const batchRows = await db
    .select()
    .from(uploadBatches)
    .where(and(eq(uploadBatches.id, batchId), eq(uploadBatches.userId, userId)))
    .limit(1);

  const batch = batchRows[0];
  if (!batch) {
    throw new Error("Batch not found");
  }
  if (batch.status !== "open") {
    throw new Error("Batch is not open for commit");
  }

  const allFiles = await db
    .select()
    .from(uploadFiles)
    .where(eq(uploadFiles.batchId, batchId));

  if (allFiles.length === 0) {
    throw new Error("Batch has no files");
  }

  const files = allFiles.filter((f) => f.status === "complete");
  if (files.length === 0) {
    throw new Error("No assembled files ready to commit");
  }

  const incomplete = allFiles.filter((f) => f.status !== "complete");
  const skippedIncompleteCount = incomplete.length;
  for (const file of incomplete) {
    if (file.status === "failed" || file.status === "cancelled") continue;
    await db
      .update(uploadFiles)
      .set({
        status: "failed",
        errorMessage: file.errorMessage ?? "Skipped — upload incomplete",
        expiresAt: new Date(Date.now() + FAILED_UPLOAD_TTL_MS),
        updatedAt: new Date(),
      })
      .where(eq(uploadFiles.id, file.id));
  }

  const warnings: string[] = [];
  if (skippedIncompleteCount > 0) {
    warnings.push(
      `${skippedIncompleteCount} file${skippedIncompleteCount === 1 ? "" : "s"} failed and were skipped`,
    );
  }

  if (config.deduplication.onDuplicate === "reject") {
    for (const file of files) {
      if (!file.contentHash) continue;
      // Sidecar-only replacements for the same asset are allowed later;
      // still reject exact duplicates of primary media hashes.
      if (isTelemetryExtension(file.extension) || isProxyExtension(file.extension)) {
        continue;
      }

      // Dual-mode: match stored contentHash against either xxhash or sha256
      // so algorithm switches still catch older uploads.
      const assembledKey = uploadAssembledKey(userId, file.id);
      const assembledStream = await storage.getStream(assembledKey, {
        tier: "cache",
      });
      let candidates = [file.contentHash];
      if (assembledStream) {
        const hashed = await hashFileStream(assembledStream);
        candidates = [hashed.digests.xxhash, hashed.digests.sha256];
      }

      const matchAssetId = await contentHashMatches(userId, candidates);
      if (matchAssetId) {
        throw new Error(
          `Duplicate file detected (matches asset ${matchAssetId})`,
        );
      }
    }
  } else {
    // flag: allow commit of identical hashes; surface in Utilities → Duplicates.
    let duplicateMatches = 0;
    for (const file of files) {
      if (!file.contentHash) continue;
      if (
        isTelemetryExtension(file.extension) ||
        isProxyExtension(file.extension)
      ) {
        continue;
      }
      const matchAssetId = await contentHashMatches(userId, [
        file.contentHash,
      ]);
      if (matchAssetId) duplicateMatches += 1;
    }
    if (duplicateMatches > 0) {
      warnings.push(
        `${duplicateMatches} file${duplicateMatches === 1 ? "" : "s"} match existing library content — review in Utilities → Duplicates (Keep both or Bin)`,
      );
    }
  }

  const totalBytes = files.reduce((sum, f) => sum + f.fileSizeBytes, 0);
  const userRows = await db
    .select({
      storageQuotaBytes: users.storageQuotaBytes,
      storageUsedBytes: users.storageUsedBytes,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const user = userRows[0];
  if (!user) throw new Error("User not found");
  if (user.storageUsedBytes + totalBytes > user.storageQuotaBytes) {
    throw new Error("Storage quota exceeded");
  }

  await db
    .update(uploadBatches)
    .set({ status: "committing", updatedAt: new Date() })
    .where(eq(uploadBatches.id, batchId));

  const { sequences: hyperlapseGroups, remaining: afterHyperlapse } =
    partitionHyperlapseSequences(files);
  const { sequences: panoramaGroups, remaining: nonSequenceFiles } =
    partitionPanoramaSequences(afterHyperlapse);

  const createdAssets: Array<{ assetId: string; fileIds: string[] }> = [];
  const newMediaAssetIds = new Set<string>();
  let newAssetBytes = 0;

  /** Mark uncommitted files failed so orphan cleanup purges them in ~2h. */
  async function markFilesFailedForSoonPurge(
    fileIds: string[],
    errorMessage: string,
  ) {
    if (fileIds.length === 0) return;
    const expiresAt = new Date(Date.now() + FAILED_UPLOAD_TTL_MS);
    await db
      .update(uploadFiles)
      .set({
        status: "failed",
        errorMessage: errorMessage.slice(0, 2000),
        expiresAt,
        updatedAt: new Date(),
      })
      .where(
        and(inArray(uploadFiles.id, fileIds), isNull(uploadFiles.assetId)),
      );
  }

  async function attachTilesToPanoramaAsset(params: {
    assetId: string;
    orderedTiles: UploadFileRow[];
    parse: (
      filename: string,
    ) => { frameNumber: number; extension: string } | null;
  }) {
    const { assetId, orderedTiles, parse } = params;
    const existing = await db
      .select()
      .from(sequenceFrames)
      .where(eq(sequenceFrames.assetId, assetId));
    const byHash = new Set(
      existing.map((frame) => frame.contentHash).filter(Boolean),
    );
    const byName = new Set(
      existing.map((frame) => frame.filename.toLowerCase()),
    );
    const usedIndexes = new Set(existing.map((frame) => frame.frameIndex));

    let addedBytes = 0;
    const attachedIds: string[] = [];

    for (const file of orderedTiles) {
      const filename = leafFilename(file.relativePath ?? file.displayName);
      if (
        (file.contentHash && byHash.has(file.contentHash)) ||
        byName.has(filename.toLowerCase())
      ) {
        await db
          .update(uploadFiles)
          .set({ assetId, updatedAt: new Date() })
          .where(eq(uploadFiles.id, file.id));
        await storage
          .delete(uploadAssembledKey(userId, file.id), { tier: "cache" })
          .catch(() => undefined);
        await storage.deletePrefix(uploadStagingPrefix(userId, file.id), {
          tier: "cache",
        });
        attachedIds.push(file.id);
        continue;
      }

      const parsed = parse(file.relativePath ?? file.displayName);
      const extension = parsed?.extension ?? file.extension;
      let frameIndex =
        parsed && parsed.frameNumber > 0 ? parsed.frameNumber - 1 : existing.length;
      while (usedIndexes.has(frameIndex)) frameIndex += 1;
      usedIndexes.add(frameIndex);

      const assembledKey = uploadAssembledKey(userId, file.id);
      const mediaKey = buildSequenceFrameKey(
        userId,
        assetId,
        frameIndex,
        extension,
      );

      await storage.move(assembledKey, mediaKey, {
        fromTier: "cache",
        toTier: "media",
      });

      await db.insert(sequenceFrames).values({
        assetId,
        userId,
        frameIndex,
        filename,
        storageKey: mediaKey,
        fileSizeBytes: file.fileSizeBytes,
        contentHash: file.contentHash!,
      });

      await db
        .update(uploadFiles)
        .set({ assetId, updatedAt: new Date() })
        .where(eq(uploadFiles.id, file.id));

      await storage.deletePrefix(uploadStagingPrefix(userId, file.id), {
        tier: "cache",
      });

      byHash.add(file.contentHash!);
      byName.add(filename.toLowerCase());
      addedBytes += file.fileSizeBytes;
      attachedIds.push(file.id);
    }

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sequenceFrames)
      .where(eq(sequenceFrames.assetId, assetId));

    await db
      .update(assets)
      .set({
        frameCount: countRow?.count ?? usedIndexes.size,
        fileSizeBytes: sql`coalesce(${assets.fileSizeBytes}, 0) + ${addedBytes}`,
        updatedAt: new Date(),
      })
      .where(eq(assets.id, assetId));

    return { attachedIds, addedBytes };
  }

  async function commitSequenceGroup(
    group: { folder: string; files: UploadFileRow[] },
    kind: SequenceKind,
  ) {
    const parse =
      kind === "panorama" ? parsePanoramaFilename : parseHyperlapseFilename;
    const djiStitched =
      kind === "panorama"
        ? group.files.find((file) =>
            isDjiStitchedPanoramaFilename(
              file.relativePath ?? file.displayName,
            ),
          )
        : undefined;
    const tileFiles = group.files.filter(
      (file) =>
        !isDjiStitchedPanoramaFilename(file.relativePath ?? file.displayName),
    );
    const ordered = [...tileFiles].sort((a, b) => {
      const aNum = parse(a.relativePath ?? a.displayName)?.frameNumber ?? 0;
      const bNum = parse(b.relativePath ?? b.displayName)?.frameNumber ?? 0;
      return aNum - bNum;
    });

    const folderLabel = sequenceFolderLabel(group.folder);
    const allFiles = djiStitched ? [...ordered, djiStitched] : ordered;

    // Stitch-first: attach tiles onto an existing panorama or promote a stitch photo.
    if (kind === "panorama") {
      const captureIndex = panoramaFolderCaptureIndex(folderLabel);
      if (captureIndex) {
        const existingSequence = await findPanoramaForCaptureIndex(
          userId,
          captureIndex,
        );
        if (existingSequence) {
          const { attachedIds, addedBytes } = await attachTilesToPanoramaAsset({
            assetId: existingSequence.id,
            orderedTiles: ordered,
            parse,
          });
          newAssetBytes += addedBytes;
          if (djiStitched) {
            await attachAssembledDjiToPanorama({
              userId,
              panoramaId: existingSequence.id,
              file: djiStitched,
              bumpFileSize: true,
              restitch: true,
            });
            attachedIds.push(djiStitched.id);
          } else {
            await enqueuePanoramaRestitch(userId, existingSequence.id);
          }
          createdAssets.push({
            assetId: existingSequence.id,
            fileIds: attachedIds,
          });
          newMediaAssetIds.add(existingSequence.id);
          return;
        }

        const existingPhoto = await findDjiPhotoForCaptureIndex(
          userId,
          captureIndex,
        );
        if (existingPhoto) {
          const promoted = await promoteStitchPhotoToPanoramaShell({
            userId,
            photoId: existingPhoto.id,
            folderLabel,
            displayName: sequenceDisplayName(group.folder, "panorama"),
          });
          if (promoted) {
            const { attachedIds, addedBytes } = await attachTilesToPanoramaAsset(
              {
                assetId: existingPhoto.id,
                orderedTiles: ordered,
                parse,
              },
            );
            newAssetBytes += addedBytes;
            if (djiStitched) {
              await attachAssembledDjiToPanorama({
                userId,
                panoramaId: existingPhoto.id,
                file: djiStitched,
                bumpFileSize: true,
                restitch: true,
              });
              attachedIds.push(djiStitched.id);
            } else {
              await enqueuePanoramaRestitch(userId, existingPhoto.id);
            }
            createdAssets.push({
              assetId: existingPhoto.id,
              fileIds: attachedIds,
            });
            newMediaAssetIds.add(existingPhoto.id);
            return;
          }
        }
      }
    }

    const assetId = crypto.randomUUID();
    let totalAssetBytes = 0;
    let primaryHash: string | null = null;
    let clientModifiedAt: Date | null = null;

    for (const file of allFiles) {
      totalAssetBytes += file.fileSizeBytes;
      if (!primaryHash) {
        primaryHash = file.contentHash ?? null;
        clientModifiedAt = file.clientModifiedAt ?? null;
      }
    }
    newAssetBytes += totalAssetBytes;

    await db.insert(assets).values({
      id: assetId,
      userId,
      displayName: sequenceDisplayName(group.folder, kind),
      assetType: "sequence",
      mainFileExt: "seq",
      hasSrt: false,
      hasLrf: false,
      contentHash: primaryHash,
      fileSizeBytes: totalAssetBytes,
      capturedAtOriginal: clientModifiedAt,
      sequenceKind: kind,
      frameCount: ordered.length,
      sequenceFolder: folderLabel,
      sequenceFps: kind === "hyperlapse" ? config.transcoding.sequences.fps : null,
    });

    for (let frameIndex = 0; frameIndex < ordered.length; frameIndex++) {
      const file = ordered[frameIndex]!;
      const parsed = parse(file.relativePath ?? file.displayName);
      const extension = parsed?.extension ?? file.extension;
      const assembledKey = uploadAssembledKey(userId, file.id);
      const mediaKey = buildSequenceFrameKey(
        userId,
        assetId,
        frameIndex,
        extension,
      );

      await storage.move(assembledKey, mediaKey, {
        fromTier: "cache",
        toTier: "media",
      });

      await db.insert(sequenceFrames).values({
        assetId,
        userId,
        frameIndex,
        filename: leafFilename(file.relativePath ?? file.displayName),
        storageKey: mediaKey,
        fileSizeBytes: file.fileSizeBytes,
        contentHash: file.contentHash!,
      });

      await db
        .update(uploadFiles)
        .set({ assetId, updatedAt: new Date() })
        .where(eq(uploadFiles.id, file.id));

      await storage.deletePrefix(uploadStagingPrefix(userId, file.id), {
        tier: "cache",
      });
    }

    if (djiStitched) {
      await attachAssembledDjiToPanorama({
        userId,
        panoramaId: assetId,
        file: djiStitched,
        bumpFileSize: false,
        restitch: false,
      });
    }

    await db.insert(assetFiles).values({
      assetId,
      userId,
      extension: "seq",
      contentHash: primaryHash ?? assetId,
      fileSizeBytes: totalAssetBytes,
    });

    createdAssets.push({
      assetId,
      fileIds: allFiles.map((f) => f.id),
    });
    newMediaAssetIds.add(assetId);
  }

  for (const group of hyperlapseGroups) {
    try {
      await commitSequenceGroup(group, "hyperlapse");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Sequence commit failed";
      warnings.push(
        `Failed hyperlapse ${group.folder}: ${message}`,
      );
      console.error(
        `[commitUploadBatch] hyperlapse ${group.folder}`,
        error,
      );
      await markFilesFailedForSoonPurge(
        group.files.map((f) => f.id),
        `Commit failed: ${message}`,
      );
    }
  }
  for (const group of panoramaGroups) {
    try {
      await commitSequenceGroup(group, "panorama");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Sequence commit failed";
      warnings.push(`Failed panorama ${group.folder}: ${message}`);
      console.error(
        `[commitUploadBatch] panorama ${group.folder}`,
        error,
      );
      await markFilesFailedForSoonPurge(
        group.files.map((f) => f.id),
        `Commit failed: ${message}`,
      );
    }
  }

  const groups = new Map<string, typeof nonSequenceFiles>();
  const sidecars: typeof nonSequenceFiles = [];

  for (const file of nonSequenceFiles) {
    if (isTelemetryExtension(file.extension) || isProxyExtension(file.extension)) {
      sidecars.push(file);
      continue;
    }
    const key = primaryMediaGroupKey({
      basename: file.basename,
      extension: file.extension,
      relativePath: file.relativePath,
    });
    const group = groups.get(key) ?? [];
    group.push(file);
    groups.set(key, group);
  }

  // Pair sidecars only with the same folder + basename. Never attach to
  // another DJI_0419 in a different folder (or a basename-only group).
  for (const sidecar of sidecars) {
    const base = groupKeyForUploadFile(sidecar.basename, sidecar.extension);
    const folder = uploadRelativeFolder(sidecar.relativePath);
    const sameFolderKey = folder ? `${folder}::${base}` : base;
    const targetKey = groups.has(sameFolderKey) ? sameFolderKey : null;
    if (targetKey) {
      groups.get(targetKey)!.push(sidecar);
    } else {
      // Sidecar-only group keyed by basename for library attach.
      const orphanKey = `sidecar::${base}`;
      const group = groups.get(orphanKey) ?? [];
      group.push(sidecar);
      groups.set(orphanKey, group);
    }
  }

  for (const [, groupFiles] of groups) {
    const basename = groupKeyForUploadFile(
      groupFiles[0]!.basename,
      groupFiles[0]!.extension,
    );
    try {
      const extensions = groupFiles.map((f) => f.extension);

      if (isSidecarOnlyGroup(extensions)) {
        const existing = await findAssetForSidecarBasename(userId, basename);
        if (existing.status === "none") {
          warnings.push(
            `Skipped ${basename}.${extensions[0]} — no matching media in this batch or library`,
          );
          continue;
        }
        if (existing.status === "ambiguous") {
          warnings.push(
            `Skipped ${basename}.${extensions[0]} — ${existing.count} library assets share that name; upload with the matching video or resolve duplicates first`,
          );
          continue;
        }
        const attached = await attachSidecarFiles({
          userId,
          assetId: existing.asset.id,
          groupFiles,
        });
        createdAssets.push(attached);
        continue;
      }

      const assetType = inferAssetType(extensions);
      if (!assetType) {
        warnings.push(
          `Skipped ${basename} — unsupported types: ${extensions.join(", ")}`,
        );
        continue;
      }

      const mainExt = pickMainExtension(extensions);
      if (!mainExt) {
        warnings.push(`Skipped ${basename} — could not determine main file`);
        continue;
      }

      const displayName = pickMainDisplayName(groupFiles);

      // DJI_0424.JPG uploaded alone (or after tiles) → attach to PANORAMA/100_0424.
      if (assetType === "photo") {
        const djiMain = groupFiles.find((file) =>
          isDjiStitchedPanoramaFilename(file.relativePath ?? file.displayName),
        );
        const parsed = djiMain
          ? parseDjiStitchedPanoramaFilename(
              djiMain.relativePath ?? djiMain.displayName,
            )
          : null;
        if (djiMain && parsed && groupFiles.length === 1) {
          const panorama = await findPanoramaForCaptureIndex(
            userId,
            parsed.captureIndex,
          );
          if (panorama) {
            await attachAssembledDjiToPanorama({
              userId,
              panoramaId: panorama.id,
              file: djiMain,
              bumpFileSize: true,
              restitch: true,
            });
            newAssetBytes += djiMain.fileSizeBytes;
            createdAssets.push({
              assetId: panorama.id,
              fileIds: [djiMain.id],
            });
            continue;
          }
        }
      }

      const assetId = crypto.randomUUID();
      const commitFiles: typeof groupFiles = [];
      for (const file of groupFiles) {
        const sidecar =
          isTelemetryExtension(file.extension) ||
          isProxyExtension(file.extension);
        if (sidecar && file.contentHash) {
          const other = await sidecarHashOwnedByOtherAsset({
            userId,
            contentHash: file.contentHash,
            extension: file.extension,
            exceptAssetId: assetId,
          });
          if (other) {
            warnings.push(
              `Skipped ${file.displayName} — identical ${file.extension} already attached to another library item`,
            );
            continue;
          }
        }
        commitFiles.push(file);
      }
      if (commitFiles.length === 0) continue;

      let totalAssetBytes = 0;
      let primaryHash: string | null = null;
      let clientModifiedAt: Date | null = null;
      for (const file of commitFiles) {
        totalAssetBytes += file.fileSizeBytes;
        if (file.extension === mainExt) {
          primaryHash = file.contentHash ?? null;
          clientModifiedAt = file.clientModifiedAt ?? null;
        }
      }
      newAssetBytes += totalAssetBytes;

      await db.insert(assets).values({
        id: assetId,
        userId,
        displayName,
        assetType,
        mainFileExt: mainExt,
        hasSrt: commitFiles.some((f) => isTelemetryExtension(f.extension)),
        hasLrf: commitFiles.some((f) => isProxyExtension(f.extension)),
        contentHash: primaryHash,
        fileSizeBytes: totalAssetBytes,
        // Provisional — metadata/SRT workers refine from EXIF / SRT / container tags.
        capturedAtOriginal: clientModifiedAt,
      });

      for (const file of commitFiles) {
        const assembledKey = uploadAssembledKey(userId, file.id);
        const mediaKey = buildMediaAssetKey(userId, assetId, file.extension);

        await storage.move(assembledKey, mediaKey, {
          fromTier: "cache",
          toTier: "media",
        });

        if (file.contentHash) {
          await reclaimContentHashFromBin(userId, file.contentHash);
        }

        await db.insert(assetFiles).values({
          assetId,
          userId,
          extension: file.extension,
          contentHash: file.contentHash!,
          fileSizeBytes: file.fileSizeBytes,
        });

        await db
          .update(uploadFiles)
          .set({ assetId, updatedAt: new Date() })
          .where(eq(uploadFiles.id, file.id));

        await storage.deletePrefix(uploadStagingPrefix(userId, file.id), {
          tier: "cache",
        });
      }

      createdAssets.push({
        assetId,
        fileIds: commitFiles.map((f) => f.id),
      });
      newMediaAssetIds.add(assetId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Commit failed";
      warnings.push(`Failed ${basename}: ${message}`);
      console.error(`[commitUploadBatch] group ${basename}`, error);
      await markFilesFailedForSoonPurge(
        groupFiles.map((f) => f.id),
        `Commit failed: ${message}`,
      );
    }
  }

  if (newAssetBytes > 0) {
    await db
      .update(users)
      .set({
        storageUsedBytes: sql`${users.storageUsedBytes} + ${newAssetBytes}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  await db
    .update(uploadBatches)
    .set({
      status: "committed",
      committedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(uploadBatches.id, batchId));

  // Enqueue each asset independently — one Redis/BullMQ failure must not
  // leave the rest of the batch without thumbnails/metadata jobs.
  let enqueueFailures = 0;
  for (const assetId of newMediaAssetIds) {
    try {
      await enqueueAssetPipeline({
        userId,
        assetId,
        onDuplicate: config.deduplication.onDuplicate,
      });
    } catch (error) {
      enqueueFailures += 1;
      console.error(
        `[commitUploadBatch] failed to enqueue pipeline for ${assetId}`,
        error,
      );
    }
  }
  if (enqueueFailures > 0) {
    warnings.push(
      `Processing queue failed for ${enqueueFailures} asset${enqueueFailures === 1 ? "" : "s"} — they will be retried automatically`,
    );
  }

  return { batchId, assets: createdAssets, warnings };
}
