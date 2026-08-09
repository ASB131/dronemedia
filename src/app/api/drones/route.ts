import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { createDrone, listDronesForUser } from "@/lib/drones/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  model: z.string().trim().max(120).optional(),
  serialNumber: z.string().trim().max(120).optional(),
});

export async function GET() {
  try {
    const session = await requireApprovedSession();
    const drones = await listDronesForUser(session.user.id);
    return NextResponse.json({ drones });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApprovedSession();
    const body = createSchema.parse(await request.json());
    const drone = await createDrone(session.user.id, body);
    return NextResponse.json({ drone }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
