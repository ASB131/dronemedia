import { and, isNotNull, lte } from "drizzle-orm";

import { purgeAssetPermanently } from "@/lib/assets/purge";
import { getWorkerDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { getLogger } from "@/lib/logger";
import { reconcileUserStorageUsed } from "@/lib/users/storage-usage";

const logger = getLogger().child({ module: "bin-cleanup" });

export async function purgeExpiredBinItems(purgeAfterDays: number) {
  const db = getWorkerDb();
  const cutoff = new Date(Date.now() - purgeAfterDays * 86_400_000);

  const rows = await db
    .select({
      id: assets.id,
      userId: assets.userId,
    })
    .from(assets)
    .where(and(isNotNull(assets.deletedAt), lte(assets.deletedAt, cutoff)));

  let purged = 0;
  const touchedUsers = new Set<string>();
  for (const row of rows) {
    const ok = await purgeAssetPermanently(db, row.userId, row.id, {
      skipStorageReconcile: true,
    });
    if (ok) {
      purged += 1;
      touchedUsers.add(row.userId);
    }
  }

  for (const userId of touchedUsers) {
    await reconcileUserStorageUsed(userId, db);
  }

  logger.info({ purged, cutoff: cutoff.toISOString() }, "Bin cleanup complete");
  return purged;
}
