import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import {
  binContentHashesForAssets,
  unbinContentHashesForAssets,
} from "@/lib/assets/content-hash-bin";
import { purgeAssetPermanently } from "@/lib/assets/purge";
import { getWebDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import {
  afterAssetsSoftDeleted,
  cleanupLibraryOrphans,
} from "@/lib/library/orphan-cleanup";
import { reconcileUserStorageUsed } from "@/lib/users/storage-usage";
import { getEffectiveCaptureDate } from "./capture";

export type BinAssetDto = {
  id: string;
  displayName: string;
  assetType: "photo" | "video" | "sequence";
  mainFileExt: string;
  deletedAt: string;
  capturedAt: string;
  fileSizeBytes: number | null;
};

export async function listBinAssets(userId: string): Promise<BinAssetDto[]> {
  const db = getWebDb();
  const rows = await db
    .select()
    .from(assets)
    .where(and(eq(assets.userId, userId), isNotNull(assets.deletedAt)))
    .orderBy(desc(assets.deletedAt));

  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    assetType: row.assetType,
    mainFileExt: row.mainFileExt,
    deletedAt: row.deletedAt!.toISOString(),
    capturedAt: getEffectiveCaptureDate(row).toISOString(),
    fileSizeBytes: row.fileSizeBytes,
  }));
}

export async function softDeleteAsset(userId: string, assetId: string) {
  const db = getWebDb();
  const [updated] = await db
    .update(assets)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(assets.id, assetId),
        eq(assets.userId, userId),
        isNull(assets.deletedAt),
      ),
    )
    .returning({ id: assets.id, flightId: assets.flightId });

  if (updated) {
    await binContentHashesForAssets([updated.id]);
    await afterAssetsSoftDeleted(userId, [updated.id], [updated.flightId]);
  }

  return updated ?? null;
}

export async function restoreAsset(userId: string, assetId: string) {
  const db = getWebDb();
  const [updated] = await db
    .update(assets)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(assets.id, assetId),
        eq(assets.userId, userId),
        isNotNull(assets.deletedAt),
      ),
    )
    .returning({ id: assets.id });

  if (updated) {
    await unbinContentHashesForAssets([updated.id]);
  }

  return updated ?? null;
}

export async function getDeletedAsset(userId: string, assetId: string) {
  const db = getWebDb();
  const [row] = await db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.id, assetId),
        eq(assets.userId, userId),
        isNotNull(assets.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function restoreBinAssets(userId: string, assetIds: string[]) {
  if (assetIds.length === 0) return { restored: 0 };
  const db = getWebDb();
  const updated = await db
    .update(assets)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(assets.userId, userId),
        isNotNull(assets.deletedAt),
        inArray(assets.id, assetIds),
      ),
    )
    .returning({ id: assets.id });

  if (updated.length > 0) {
    await unbinContentHashesForAssets(updated.map((row) => row.id));
  }

  return { restored: updated.length };
}

export async function purgeBinAssets(userId: string, assetIds: string[]) {
  if (assetIds.length === 0) return { purged: 0 };
  const db = getWebDb();
  const rows = await db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.userId, userId),
        isNotNull(assets.deletedAt),
        inArray(assets.id, assetIds),
      ),
    );

  let purged = 0;
  for (const row of rows) {
    const ok = await purgeAssetPermanently(db, userId, row.id, {
      skipStorageReconcile: true,
    });
    if (ok) purged += 1;
  }

  if (purged > 0) {
    await reconcileUserStorageUsed(userId, db);
    await cleanupLibraryOrphans(userId);
  }

  return { purged };
}

/**
 * Permanently delete live (non-binned) assets — originals, thumbs, HLS, panos,
 * exports, and related orphans. Used by Utilities → Duplicates "Delete selected".
 */
export async function purgeLiveAssets(userId: string, assetIds: string[]) {
  if (assetIds.length === 0) return { purged: 0 };
  const db = getWebDb();
  const rows = await db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.userId, userId),
        isNull(assets.deletedAt),
        inArray(assets.id, assetIds),
      ),
    );

  let purged = 0;
  for (const row of rows) {
    const ok = await purgeAssetPermanently(db, userId, row.id, {
      skipStorageReconcile: true,
    });
    if (ok) purged += 1;
  }

  if (purged > 0) {
    await reconcileUserStorageUsed(userId, db);
    await cleanupLibraryOrphans(userId);
  }

  return { purged };
}
