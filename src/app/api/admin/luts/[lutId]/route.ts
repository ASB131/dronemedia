import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, jsonError, requireAdminSession } from "@/lib/api/auth";
import { getWebDb } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { deleteLut, updateLutColorProfile } from "@/lib/luts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  colorProfile: z.enum(["d_log", "d_logm"]),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ lutId: string }> },
) {
  try {
    const session = await requireAdminSession();
    const { lutId } = await context.params;
    const body = patchSchema.parse(await request.json());
    const lut = await updateLutColorProfile(lutId, body.colorProfile);
    if (!lut) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const db = getWebDb();
    await db.insert(auditLogs).values({
      actorUserId: session.user.id,
      actionType: "lut.create",
      targetType: "lut",
      targetId: lutId,
      metadata: { colorProfile: lut.colorProfile, action: "update_profile" },
    });

    return NextResponse.json({ lut });
  } catch (error) {
    if (error instanceof ApiError) return jsonError(error);
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return jsonError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ lutId: string }> },
) {
  try {
    const session = await requireAdminSession();
    const { lutId } = await context.params;
    const deleted = await deleteLut(lutId);
    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const db = getWebDb();
    await db.insert(auditLogs).values({
      actorUserId: session.user.id,
      actionType: "lut.delete",
      targetType: "lut",
      targetId: lutId,
      metadata: {},
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
