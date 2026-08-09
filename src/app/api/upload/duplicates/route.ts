import { NextResponse } from "next/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { getWebDb } from "@/lib/db";
import { assetFiles, assets } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  digests: z.array(z.string().min(1).max(128)).max(200).optional(),
  soft: z
    .array(
      z.object({
        key: z.string().min(1).max(512),
        basename: z.string().min(1).max(512),
        sizeBytes: z.number().int().nonnegative(),
      }),
    )
    .max(200)
    .optional(),
});

export async function POST(request: Request) {
  try {
    const session = await requireApprovedSession();
    const userId = session.user.id;
    const body = bodySchema.parse(await request.json());
    const db = getWebDb();

    const hashMatches: Array<{
      digest: string;
      assetId: string;
      displayName: string;
    }> = [];

    const digests = [...new Set((body.digests ?? []).filter(Boolean))];
    if (digests.length > 0) {
      const fileRows = await db
        .select({
          contentHash: assetFiles.contentHash,
          assetId: assetFiles.assetId,
          displayName: assets.displayName,
        })
        .from(assetFiles)
        .innerJoin(assets, eq(assets.id, assetFiles.assetId))
        .where(
          and(
            eq(assetFiles.userId, userId),
            inArray(assetFiles.contentHash, digests),
            isNull(assets.deletedAt),
          ),
        );

      const assetHashRows = await db
        .select({
          contentHash: assets.contentHash,
          assetId: assets.id,
          displayName: assets.displayName,
        })
        .from(assets)
        .where(
          and(
            eq(assets.userId, userId),
            inArray(assets.contentHash, digests),
            isNull(assets.deletedAt),
          ),
        );

      const seen = new Set<string>();
      for (const row of [...fileRows, ...assetHashRows]) {
        const digest = row.contentHash;
        if (!digest) continue;
        const key = `${digest}:${row.assetId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hashMatches.push({
          digest,
          assetId: row.assetId,
          displayName: row.displayName,
        });
      }
    }

    const softMatches: Array<{
      key: string;
      assetId: string;
      displayName: string;
    }> = [];

    for (const item of body.soft ?? []) {
      const basenameKey = item.basename.toLowerCase();
      const rows = await db
        .select({
          assetId: assets.id,
          displayName: assets.displayName,
          fileSizeBytes: assets.fileSizeBytes,
        })
        .from(assets)
        .where(
          and(
            eq(assets.userId, userId),
            isNull(assets.deletedAt),
            eq(assets.fileSizeBytes, item.sizeBytes),
            sql`lower(regexp_replace(${assets.displayName}, '\\.[^.]+$', '')) = ${basenameKey}`,
          ),
        )
        .limit(3);

      for (const row of rows) {
        softMatches.push({
          key: item.key,
          assetId: row.assetId,
          displayName: row.displayName,
        });
      }
    }

    return NextResponse.json({ hashMatches, softMatches });
  } catch (error) {
    return jsonError(error);
  }
}
