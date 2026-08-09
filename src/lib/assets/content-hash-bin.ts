import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { getWebDb } from "@/lib/db";
import { assetFiles, assets, sequenceFrames } from "@/lib/db/schema";

/** Soft-deleted assets park hashes so live re-uploads can reuse the same file. */
export function toBinnedContentHash(assetId: string, contentHash: string): string {
  if (contentHash.startsWith("bin:")) return contentHash;
  return `bin:${assetId}:${contentHash}`;
}

export function fromBinnedContentHash(contentHash: string): string {
  const match = /^bin:[0-9a-f-]+:(.+)$/i.exec(contentHash);
  return match?.[1] ?? contentHash;
}

/** Rename content hashes for soft-deleted assets so the unique index frees up. */
export async function binContentHashesForAssets(assetIds: string[]) {
  if (assetIds.length === 0) return;
  const db = getWebDb();

  const fileRows = await db
    .select({
      id: assetFiles.id,
      assetId: assetFiles.assetId,
      contentHash: assetFiles.contentHash,
    })
    .from(assetFiles)
    .where(inArray(assetFiles.assetId, assetIds));

  for (const row of fileRows) {
    const next = toBinnedContentHash(row.assetId, row.contentHash);
    if (next === row.contentHash) continue;
    await db
      .update(assetFiles)
      .set({ contentHash: next })
      .where(eq(assetFiles.id, row.id));
  }

  const frameRows = await db
    .select({
      id: sequenceFrames.id,
      assetId: sequenceFrames.assetId,
      contentHash: sequenceFrames.contentHash,
    })
    .from(sequenceFrames)
    .where(inArray(sequenceFrames.assetId, assetIds));

  for (const row of frameRows) {
    const next = toBinnedContentHash(row.assetId, row.contentHash);
    if (next === row.contentHash) continue;
    await db
      .update(sequenceFrames)
      .set({ contentHash: next })
      .where(eq(sequenceFrames.id, row.id));
  }

  await db
    .update(assets)
    .set({
      contentHash: sql`case
        when ${assets.contentHash} is null then null
        when ${assets.contentHash} like 'bin:%' then ${assets.contentHash}
        else 'bin:' || ${assets.id}::text || ':' || ${assets.contentHash}
      end`,
      updatedAt: new Date(),
    })
    .where(inArray(assets.id, assetIds));
}

/** Restore original content hashes when taking an asset out of the bin. */
export async function unbinContentHashesForAssets(assetIds: string[]) {
  if (assetIds.length === 0) return;
  const db = getWebDb();

  const fileRows = await db
    .select({
      id: assetFiles.id,
      contentHash: assetFiles.contentHash,
    })
    .from(assetFiles)
    .where(inArray(assetFiles.assetId, assetIds));

  for (const row of fileRows) {
    const next = fromBinnedContentHash(row.contentHash);
    if (next === row.contentHash) continue;
    await db
      .update(assetFiles)
      .set({ contentHash: next })
      .where(eq(assetFiles.id, row.id));
  }

  const frameRows = await db
    .select({
      id: sequenceFrames.id,
      contentHash: sequenceFrames.contentHash,
    })
    .from(sequenceFrames)
    .where(inArray(sequenceFrames.assetId, assetIds));

  for (const row of frameRows) {
    const next = fromBinnedContentHash(row.contentHash);
    if (next === row.contentHash) continue;
    await db
      .update(sequenceFrames)
      .set({ contentHash: next })
      .where(eq(sequenceFrames.id, row.id));
  }

  await db
    .update(assets)
    .set({
      contentHash: sql`case
        when ${assets.contentHash} is null then null
        when ${assets.contentHash} like 'bin:%' then regexp_replace(${assets.contentHash}, '^bin:[^:]+:', '')
        else ${assets.contentHash}
      end`,
      updatedAt: new Date(),
    })
    .where(inArray(assets.id, assetIds));
}

/**
 * Before committing a live file with this hash, park any colliding rows that
 * still belong to soft-deleted assets (legacy bins before hash parking).
 */
export async function reclaimContentHashFromBin(
  userId: string,
  contentHash: string,
) {
  if (!contentHash || contentHash.startsWith("bin:")) return;
  const db = getWebDb();

  const rows = await db
    .select({
      id: assetFiles.id,
      assetId: assetFiles.assetId,
    })
    .from(assetFiles)
    .innerJoin(assets, eq(assets.id, assetFiles.assetId))
    .where(
      and(
        eq(assetFiles.userId, userId),
        eq(assetFiles.contentHash, contentHash),
        isNotNull(assets.deletedAt),
      ),
    );

  for (const row of rows) {
    await db
      .update(assetFiles)
      .set({ contentHash: toBinnedContentHash(row.assetId, contentHash) })
      .where(eq(assetFiles.id, row.id));
  }
}
