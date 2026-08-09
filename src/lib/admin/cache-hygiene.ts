import fs from "node:fs/promises";
import path from "node:path";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { videoHlsPrefix } from "@/lib/assets/hls";
import { clearAssetPlaybackFlags } from "@/lib/assets/playback-flags";
import { videoProxyCacheKey } from "@/lib/assets/transcoding";
import { loadConfig } from "@/lib/config";
import { getWebDb, getWebPool } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { getWebTranscodingQueue } from "@/lib/jobs/queues";
import { getRedis } from "@/lib/redis";
import { getStorageAdapter } from "@/lib/storage";

async function dirSizeBytes(root: string): Promise<number> {
  let total = 0;
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(full);
          total += stat.size;
        } catch {
          // skip
        }
      }
    }
  }
  await walk(root);
  return total;
}

async function firstLevelDirSizes(
  root: string,
): Promise<{ name: string; bytes: number }[]> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = entries.filter((entry) => entry.isDirectory());
  const sizes = await Promise.all(
    dirs.map(async (entry) => ({
      name: entry.name,
      bytes: await dirSizeBytes(path.join(root, entry.name)),
    })),
  );
  return sizes.sort((a, b) => b.bytes - a.bytes);
}

export async function getCacheSizeReport() {
  const config = loadConfig();
  const cacheRoot = config.storage.cachePath;
  const [thumbnails, proxies, hls, exportsDir, panos, uploads, previews, total] =
    await Promise.all([
      dirSizeBytes(path.join(cacheRoot, "thumbnails")),
      dirSizeBytes(path.join(cacheRoot, "proxies")),
      dirSizeBytes(path.join(cacheRoot, "hls")),
      dirSizeBytes(path.join(cacheRoot, "exports")),
      dirSizeBytes(path.join(cacheRoot, "panos")),
      dirSizeBytes(path.join(cacheRoot, "uploads")),
      dirSizeBytes(path.join(cacheRoot, "previews")),
      dirSizeBytes(cacheRoot),
    ]);

  return {
    cachePath: cacheRoot,
    bytes: {
      total,
      thumbnails,
      proxies,
      hls,
      exports: exportsDir,
      panos,
      uploads,
      previews,
    },
  };
}

async function postgresDatabaseBytes(): Promise<number> {
  const { rows } = await getWebPool().query<{ size: string }>(
    "SELECT pg_database_size(current_database())::text AS size",
  );
  return Number(rows[0]?.size ?? 0) || 0;
}

async function redisUsedMemoryBytes(): Promise<number> {
  const redis = getRedis();
  try {
    if (redis.status !== "ready") {
      await redis.connect();
    }
    const info = await redis.info("memory");
    const match = /^used_memory:(\d+)/m.exec(info);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

export async function getStorageSizeReport() {
  const config = loadConfig();
  const mediaPath = config.storage.mediaPath;
  const cachePath = config.storage.cachePath;
  const appDataPath = config.storage.appDataPath;

  const [cache, mediaTotal, mediaChildren, appTotal, postgresBytes, redisBytes] =
    await Promise.all([
      getCacheSizeReport(),
      dirSizeBytes(mediaPath),
      firstLevelDirSizes(mediaPath),
      dirSizeBytes(appDataPath),
      postgresDatabaseBytes(),
      redisUsedMemoryBytes(),
    ]);

  return {
    summary: [
      {
        id: "media",
        label: "Bulk storage (media)",
        path: mediaPath,
        bytes: mediaTotal,
      },
      {
        id: "cache",
        label: "Cache",
        path: cachePath,
        bytes: cache.bytes.total,
      },
      {
        id: "postgres",
        label: "Database (Postgres)",
        path: "logical database size",
        bytes: postgresBytes,
      },
      {
        id: "app",
        label: "App data",
        path: appDataPath,
        bytes: appTotal,
      },
      {
        id: "redis",
        label: "Redis (used memory)",
        path: "used_memory",
        bytes: redisBytes,
      },
    ],
    media: {
      path: mediaPath,
      bytes: mediaTotal,
      children: mediaChildren,
    },
    cache,
    app: {
      path: appDataPath,
      bytes: appTotal,
    },
    postgres: {
      bytes: postgresBytes,
    },
    redis: {
      bytes: redisBytes,
    },
  };
}

/** Delete regenerable proxy/HLS for assets and optionally requeue transcoding. */
export async function purgeAssetCacheDerivatives(
  assetIds: string[],
  options?: { requeue?: boolean },
) {
  const db = getWebDb();
  const storage = getStorageAdapter();
  const rows = await db
    .select({
      id: assets.id,
      userId: assets.userId,
      assetType: assets.assetType,
      sequenceKind: assets.sequenceKind,
    })
    .from(assets)
    .where(and(inArray(assets.id, assetIds), isNull(assets.deletedAt)));

  let purged = 0;
  for (const row of rows) {
    await storage.delete(videoProxyCacheKey(row.userId, row.id), {
      tier: "cache",
    });
    await storage.deletePrefix(videoHlsPrefix(row.userId, row.id), {
      tier: "cache",
    });
    await clearAssetPlaybackFlags(row.id);
    purged += 1;
  }

  let queued = 0;
  if (options?.requeue) {
    const queue = getWebTranscodingQueue();
    const config = loadConfig();
    for (const row of rows) {
      if (
        row.assetType !== "video" &&
        !(row.assetType === "sequence" && row.sequenceKind !== "panorama")
      ) {
        continue;
      }
      await queue.add(
        "webTranscoding",
        { userId: row.userId, assetId: row.id },
        {
          attempts: config.jobs.retry.attempts,
          backoff: {
            type: "exponential",
            delay: config.jobs.retry.backoffMs,
          },
        },
      );
      queued += 1;
    }
  }

  return { purged, queued };
}

export async function listAssetsMissingPlaybackFlags(limit = 200) {
  const db = getWebDb();
  return db
    .select({
      id: assets.id,
      userId: assets.userId,
      displayName: assets.displayName,
      assetType: assets.assetType,
    })
    .from(assets)
    .where(
      and(
        isNull(assets.deletedAt),
        inArray(assets.assetType, ["video", "sequence"]),
        eq(assets.hasProxy, false),
        eq(assets.hasHls, false),
      ),
    )
    .limit(limit);
}
