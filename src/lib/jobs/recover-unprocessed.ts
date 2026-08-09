import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { loadConfig } from "@/lib/config";
import { getWebDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { getRedis } from "@/lib/redis";
import { enqueueAssetPipeline } from "./enqueue";
import { listQueuedAssetIds } from "./user-pipeline-jobs";

const RECOVERY_LOCK_KEY = (userId: string) =>
  `notifications:recover-lock:${userId}`;
const RECOVERY_LOCK_SECONDS = 60;

/**
 * Re-enqueue assets that were committed but never got (or lost) pipeline jobs.
 * Guarded by a short Redis lock so notification polling cannot stampede.
 */
export async function recoverUnprocessedAssets(userId: string): Promise<number> {
  const redis = getRedis();
  if (redis.status !== "ready") {
    await redis.connect();
  }

  const locked = await redis.set(
    RECOVERY_LOCK_KEY(userId),
    "1",
    "EX",
    RECOVERY_LOCK_SECONDS,
    "NX",
  );
  if (locked !== "OK") return 0;

  const db = getWebDb();
  const config = loadConfig();

  // No media_metadata means the metadata step never finished (or never ran).
  const candidates = await db
    .select({
      id: assets.id,
      displayName: assets.displayName,
    })
    .from(assets)
    .where(
      and(
        eq(assets.userId, userId),
        isNull(assets.deletedAt),
        isNull(assets.mediaMetadata),
        sql`${assets.createdAt} > now() - interval '14 days'`,
      ),
    )
    .orderBy(desc(assets.createdAt))
    .limit(40);

  if (candidates.length === 0) return 0;

  const queuedIds = await listQueuedAssetIds(userId);
  let enqueued = 0;

  for (const asset of candidates) {
    if (queuedIds.has(asset.id)) continue;
    try {
      await enqueueAssetPipeline({
        userId,
        assetId: asset.id,
        onDuplicate: config.deduplication.onDuplicate,
        assetName: asset.displayName,
      });
      queuedIds.add(asset.id);
      enqueued += 1;
    } catch (error) {
      console.error(
        `[recoverUnprocessedAssets] failed for ${asset.id}`,
        error,
      );
    }
  }

  return enqueued;
}
