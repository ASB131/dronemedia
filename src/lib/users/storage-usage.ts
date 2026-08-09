import { eq, sql } from "drizzle-orm";

import type { Database } from "@/lib/db";
import { getWebDb } from "@/lib/db";
import { assets, users } from "@/lib/db/schema";

/**
 * Recompute users.storage_used_bytes from remaining asset rows.
 * Soft-deleted (bin) assets still count — files remain on disk until purged.
 */
export async function reconcileUserStorageUsed(
  userId: string,
  db: Database = getWebDb(),
): Promise<number> {
  const [row] = await db
    .select({
      usedBytes: sql<string>`coalesce(sum(${assets.fileSizeBytes}), 0)::text`,
    })
    .from(assets)
    .where(eq(assets.userId, userId));

  const usedBytes = Math.max(0, Number(row?.usedBytes ?? 0) || 0);

  await db
    .update(users)
    .set({
      storageUsedBytes: usedBytes,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return usedBytes;
}
