import { NextResponse } from "next/server";

import { restoreAsset } from "@/lib/assets/bin";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { assetId } = await context.params;
    const restored = await restoreAsset(session.user.id, assetId);

    if (!restored) {
      return NextResponse.json({ error: "Not found in bin" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
