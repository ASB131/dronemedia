#!/usr/bin/env tsx
/**
 * One-shot: sync assets.has_proxy / has_hls from cache (+ LRF-as-proxy).
 * Safe to re-run. Invoked after migrate.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";

import { refreshAssetPlaybackFlags } from "@/lib/assets/playback-flags";
import { getWebDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";

async function main() {
  const db = getWebDb();
  const rows = await db
    .select({
      id: assets.id,
      userId: assets.userId,
      hasLrf: assets.hasLrf,
    })
    .from(assets)
    .where(
      and(
        isNull(assets.deletedAt),
        inArray(assets.assetType, ["video", "sequence"]),
      ),
    );

  console.log(`[backfill-playback-flags] Scanning ${rows.length} assets…`);
  let updated = 0;
  for (const row of rows) {
    await refreshAssetPlaybackFlags(row.userId, row.id, {
      hasLrf: row.hasLrf,
    });
    updated += 1;
    if (updated % 25 === 0) {
      console.log(`[backfill-playback-flags] ${updated}/${rows.length}`);
    }
  }
  console.log(`[backfill-playback-flags] Done (${updated})`);
}

main().catch((error) => {
  console.error("[backfill-playback-flags] Failed:", error);
  process.exit(1);
});
