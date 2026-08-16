import { NextResponse } from "next/server";

import { getOwnedAsset } from "@/lib/assets/access";
import { regenerateAssetHlsPreview } from "@/lib/assets/regenerate-hls";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Force-rebuild streaming previews for this asset using current admin heights. */
export async function POST(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { assetId } = await context.params;
    const owned = await getOwnedAsset(session.user.id, assetId);
    if (!owned) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (
      owned.assetType !== "video" &&
      !(owned.assetType === "sequence" && owned.sequenceKind !== "panorama")
    ) {
      return NextResponse.json(
        { error: "Streaming previews are only for videos" },
        { status: 400 },
      );
    }

    const result = await regenerateAssetHlsPreview({
      userId: session.user.id,
      assetId,
      assetName: owned.displayName,
    });
    if (!result.queued) {
      return NextResponse.json(
        { error: result.reason ?? "Could not queue preview generation" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, queued: true });
  } catch (error) {
    return jsonError(error);
  }
}
