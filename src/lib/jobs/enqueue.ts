import { eq } from "drizzle-orm";

import { loadConfig } from "@/lib/config";
import { getWebDb, getWorkerDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { storeAndPublishNotification } from "@/lib/notifications/store";
import { getRedis } from "@/lib/redis";
import { getDedupQueue } from "./queues";
import type { JobEventPayload, JobName } from "./types";

async function resolveAssetName(
  assetId: string | undefined,
  provided?: string,
): Promise<string | undefined> {
  if (provided) return provided;
  if (!assetId) return undefined;
  try {
    const db = getWorkerDb();
    const [row] = await db
      .select({ displayName: assets.displayName })
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);
    if (row?.displayName) return row.displayName;
  } catch {
    // fall through to web pool
  }
  try {
    const [row] = await getWebDb()
      .select({ displayName: assets.displayName })
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);
    return row?.displayName;
  } catch {
    return undefined;
  }
}

export async function publishJobEvent(event: JobEventPayload) {
  const redis = getRedis();
  if (redis.status !== "ready") {
    await redis.connect();
  }
  const assetName = await resolveAssetName(event.assetId, event.assetName);
  await storeAndPublishNotification(redis, {
    ...event,
    ...(assetName ? { assetName } : {}),
  });
}

export async function enqueueAssetPipeline(params: {
  userId: string;
  assetId: string;
  onDuplicate: "reject" | "flag";
  assetName?: string;
}) {
  const config = loadConfig();
  const queue = getDedupQueue();
  // BullMQ custom ids cannot contain ":".
  const jobId = `dedup-${params.assetId}`;

  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "completed" || state === "failed") {
      await existing.remove().catch(() => undefined);
    } else {
      // Already waiting/active — refresh the notification only.
      await publishJobEvent({
        userId: params.userId,
        jobType: "dedup" as JobName,
        assetId: params.assetId,
        assetName: params.assetName,
        status: state === "active" ? "processing" : "queued",
        timestamp: new Date().toISOString(),
      });
      return;
    }
  }

  await queue.add(
    "dedup",
    {
      userId: params.userId,
      assetId: params.assetId,
      onDuplicate: params.onDuplicate,
    },
    {
      jobId,
      attempts: config.jobs.retry.attempts,
      backoff: {
        type: "exponential",
        delay: config.jobs.retry.backoffMs,
      },
      removeOnComplete: 1000,
      removeOnFail: false,
    },
  );

  await publishJobEvent({
    userId: params.userId,
    jobType: "dedup" as JobName,
    assetId: params.assetId,
    assetName: params.assetName,
    status: "queued",
    timestamp: new Date().toISOString(),
  });
}
