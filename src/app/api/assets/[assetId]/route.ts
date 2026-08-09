import { NextResponse } from "next/server";
import { z } from "zod";

import { softDeleteAsset } from "@/lib/assets/bin";
import { getAssetDetailForUser } from "@/lib/assets/detail";
import { updateOwnedAsset } from "@/lib/assets/mutations";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  displayName: z.string().trim().min(1).max(255).optional(),
  favorite: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  capturedAtOverride: z.string().datetime().nullable().optional(),
  locationOverride: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .nullable()
    .optional(),
  droneId: z.string().uuid().nullable().optional(),
  sequenceFps: z.number().min(1).max(120).optional(),
  preferredLutId: z.string().uuid().nullable().optional(),
  panoramaViewer: z.enum(["photo", "180", "360"]).optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { assetId } = await context.params;
    const asset = await getAssetDetailForUser(session.user.id, assetId);

    if (!asset) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ asset });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { assetId } = await context.params;
    const body = patchSchema.parse(await request.json());

    const updated = await updateOwnedAsset(session.user.id, assetId, {
      displayName: body.displayName,
      favorite: body.favorite,
      isPublic: body.isPublic,
      description: body.description,
      tags: body.tags,
      capturedAtOverride:
        body.capturedAtOverride === undefined
          ? undefined
          : body.capturedAtOverride === null
            ? null
            : new Date(body.capturedAtOverride),
      locationOverride: body.locationOverride,
      droneId: body.droneId,
      sequenceFps: body.sequenceFps,
      preferredLutId: body.preferredLutId,
      panoramaViewer: body.panoramaViewer,
    });

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const asset = await getAssetDetailForUser(session.user.id, assetId);
    return NextResponse.json({ asset });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { assetId } = await context.params;
    const deleted = await softDeleteAsset(session.user.id, assetId);

    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
