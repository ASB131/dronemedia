import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { getPhotoClipContextForUser } from "@/lib/flights/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { assetId } = await context.params;
    const contextDto = await getPhotoClipContextForUser(
      session.user.id,
      assetId,
    );
    return NextResponse.json({ context: contextDto });
  } catch (error) {
    return jsonError(error);
  }
}
