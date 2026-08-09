#!/usr/bin/env tsx
/**
 * Re-enqueue web transcoding (MP4 proxy + HLS) for all video/sequence assets.
 * After raising HLS ladder / maxHeight, the worker rebuilds ABR packages that
 * are missing expected rungs (e.g. 1080/1440).
 * Usage: npx tsx scripts/requeue-web-transcoding.ts
 */
import { and, inArray, isNull } from "drizzle-orm";

import { loadConfig } from "@/lib/config";
import { getWorkerDb, closeDbPools } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { getWebTranscodingQueue, closeQueues } from "@/lib/jobs/queues";

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
      and(
        isNull(assets.deletedAt),
        inArray(assets.assetType, ["video", "sequence"]),
      ),
    );
  const queue = getWebTranscodingQueue();
  let queued = 0;
  for (const row of rows) {
    await queue.add(
      "webTranscoding",
      { userId: row.userId, assetId: row.id },
      { removeOnComplete: 100, removeOnFail: 50 },
    );
    queued += 1;
  }

  console.log(`[requeue-web-transcoding] Queued ${queued} jobs`);
  await closeQueues();
  await closeDbPools();
}

main().catch(async (error) => {
  console.error("[requeue-web-transcoding] Failed:", error);
  await closeQueues().catch(() => undefined);
  await closeDbPools().catch(() => undefined);
  process.exit(1);
});
