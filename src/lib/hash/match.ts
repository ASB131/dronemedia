import { and, eq, inArray, isNull } from "drizzle-orm";

import { getWebDb } from "@/lib/db";
import { assetFiles, assets } from "@/lib/db/schema";

/** Returns a matching live assetId if any stored contentHash equals one of the digests. */
export async function contentHashMatches(
  userId: string,
  digests: string[],
  options?: { excludeAssetId?: string },
): Promise<string | null> {
  const unique = [...new Set(digests.filter(Boolean))];
  if (unique.length === 0) return null;

  const db = getWebDb();
  const rows = await db
    .select({ assetId: assetFiles.assetId })
    .from(assetFiles)
    .innerJoin(assets, eq(assets.id, assetFiles.assetId))
    .where(
      and(
        eq(assetFiles.userId, userId),
        inArray(assetFiles.contentHash, unique),
        isNull(assets.deletedAt),
      ),
    );

  const match = rows.find(
    (row) =>
      !options?.excludeAssetId || row.assetId !== options.excludeAssetId,
  );
  return match?.assetId ?? null;
}
