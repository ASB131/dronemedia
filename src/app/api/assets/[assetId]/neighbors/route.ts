import { NextResponse } from "next/server";

import { getAssetNeighborsForUser } from "@/lib/assets/detail";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { assetId } = await context.params;
    const neighbors = await getAssetNeighborsForUser(session.user.id, assetId);
    if (!neighbors) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(neighbors);
  } catch (error) {
    return jsonError(error);
  }
}
