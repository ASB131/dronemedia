#!/usr/bin/env tsx
import { and, eq, isNull } from "drizzle-orm";

import { loadConfig } from "@/lib/config";
import { getWorkerDb, closeDbPools } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { getThumbnailsQueue, closeQueues } from "@/lib/jobs/queues";

async function main() {
  loadConfig();
  const db = getWorkerDb();
  const rows = await db
    .select({ id: assets.id, userId: assets.userId })
    .from(assets)
    .where(
      and(
        isNull(assets.deletedAt),
        eq(assets.assetType, "photo"),
        isNull(assets.perceptualHash),
      ),
    );

  const queue = getThumbnailsQueue();
  for (const row of rows) {
    await queue.add(
      "thumbnails",
      { userId: row.userId, assetId: row.id },
      { removeOnComplete: 100, removeOnFail: 50 },
    );
  }
  console.log(`[requeue-thumbnails] Queued ${rows.length} photo jobs`);
  await closeQueues();
  await closeDbPools();
}

main().catch(async (error) => {
  console.error(error);
  await closeQueues().catch(() => undefined);
  await closeDbPools().catch(() => undefined);
  process.exit(1);
});
