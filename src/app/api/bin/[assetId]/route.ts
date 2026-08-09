import { NextResponse } from "next/server";

import { getDeletedAsset } from "@/lib/assets/bin";
import { purgeAssetPermanently } from "@/lib/assets/purge";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { getWebDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { assetId } = await context.params;
    const asset = await getDeletedAsset(session.user.id, assetId);

    if (!asset) {
      return NextResponse.json({ error: "Not found in bin" }, { status: 404 });
    }

    await purgeAssetPermanently(getWebDb(), session.user.id, assetId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
