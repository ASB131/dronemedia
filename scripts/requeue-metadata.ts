#!/usr/bin/env tsx
/**
 * Re-enqueue metadata jobs for assets missing media_metadata.
 * Usage: npx tsx scripts/requeue-metadata.ts
 */
import { and, isNull, sql } from "drizzle-orm";

import { loadConfig } from "@/lib/config";
import { getWorkerDb, closeDbPools } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { getMetadataQueue, closeQueues } from "@/lib/jobs/queues";

async function main() {
  loadConfig();
  const db = getWorkerDb();
  const rows = await db
    .select({
      id: assets.id,
      userId: assets.userId,
    })
    .from(assets)
    .where(
      and(isNull(assets.deletedAt), sql`${assets.mediaMetadata} is null`),
    );

  const queue = getMetadataQueue();
  let queued = 0;
  for (const row of rows) {
    await queue.add(
      "metadata",
      { userId: row.userId, assetId: row.id },
      { removeOnComplete: 100, removeOnFail: 50 },
    );
    queued += 1;
  }

  console.log(`[requeue-metadata] Queued ${queued} metadata jobs`);
  await closeQueues();
  await closeDbPools();
}

main().catch(async (error) => {
  console.error("[requeue-metadata] Failed:", error);
  await closeQueues().catch(() => undefined);
  await closeDbPools().catch(() => undefined);
  process.exit(1);
});
