import { NextResponse } from "next/server";
import { z } from "zod";

import { addAssetToAlbum } from "@/lib/albums/queries";
import { purgeLiveAssets } from "@/lib/assets/bin";
import { bulkUpdateOwnedAssets } from "@/lib/assets/mutations";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum([
    "favorite",
    "unfavorite",
    "bin",
    "purge",
    "addToAlbum",
    "makePublic",
    "makePrivate",
  ]),
  albumId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  try {
    const session = await requireApprovedSession();
    const body = bodySchema.parse(await request.json());

    if (body.action === "addToAlbum") {
      if (!body.albumId) {
        return NextResponse.json(
          { error: "albumId required" },
          { status: 400 },
        );
      }
      let added = 0;
      for (const assetId of body.assetIds) {
        const result = await addAssetToAlbum(
          session.user.id,
          body.albumId,
          assetId,
        );
        if (result) added += 1;
      }
      return NextResponse.json({ ok: true, added });
    }

    if (body.action === "purge") {
      const result = await purgeLiveAssets(session.user.id, body.assetIds);
      return NextResponse.json({ ok: true, ...result });
    }

    const result = await bulkUpdateOwnedAssets(session.user.id, body.assetIds, {
      favorite:
        body.action === "favorite"
          ? true
          : body.action === "unfavorite"
            ? false
            : undefined,
      isPublic:
        body.action === "makePublic"
          ? true
          : body.action === "makePrivate"
            ? false
            : undefined,
      softDelete: body.action === "bin",
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
