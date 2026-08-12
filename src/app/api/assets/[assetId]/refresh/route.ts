import { NextResponse } from "next/server";
import { z } from "zod";

import { getAccessibleAsset } from "@/lib/assets/access";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { enqueueAssetRefresh } from "@/lib/jobs/refresh-asset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  thumbnails: z.boolean().optional(),
  metadata: z.boolean().optional(),
  dedup: z.boolean().optional(),
  webTranscoding: z.boolean().optional(),
  panoramaStitch: z.boolean().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { assetId } = await context.params;
    const asset = await getAccessibleAsset(session.user.id, assetId);
    if (!asset) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (asset.userId !== session.user.id && session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const result = await enqueueAssetRefresh({
      userId: asset.userId,
      assetId,
      assetName: asset.displayName,
      options: body,
    });

    return NextResponse.json({
      ok: true,
      queued: result.queued,
      message:
        "Refresh queued. Originals are not re-uploaded; derivatives will rebuild.",
    });
  } catch (error) {
    return jsonError(error);
  }
}
