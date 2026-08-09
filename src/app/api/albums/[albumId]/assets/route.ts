import { NextResponse } from "next/server";
import { z } from "zod";

import {
  addAssetToAlbum,
  removeAssetFromAlbum,
} from "@/lib/albums/queries";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  assetId: z.string().uuid(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ albumId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { albumId } = await context.params;
    const body = bodySchema.parse(await request.json());
    const result = await addAssetToAlbum(
      session.user.id,
      albumId,
      body.assetId,
    );

    if (!result) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ albumId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { albumId } = await context.params;
    const body = bodySchema.parse(await request.json());
    const result = await removeAssetFromAlbum(
      session.user.id,
      albumId,
      body.assetId,
    );

    if (!result) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
