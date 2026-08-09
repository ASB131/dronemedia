import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { deleteDrone, updateDrone } from "@/lib/drones/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().max(120).nullable().optional(),
  serialNumber: z.string().trim().max(120).nullable().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ droneId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { droneId } = await context.params;
    const body = updateSchema.parse(await request.json());
    const drone = await updateDrone(session.user.id, droneId, body);

    if (!drone) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ drone });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ droneId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { droneId } = await context.params;
    const deleted = await deleteDrone(session.user.id, droneId);

    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
