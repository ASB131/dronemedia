import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { createTrip, listTripsForUser } from "@/lib/trips/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  startDate: z.string().min(10).max(10),
  endDate: z.string().min(10).max(10),
});

export async function GET() {
  try {
    const session = await requireApprovedSession();
    const trips = await listTripsForUser(session.user.id);
    return NextResponse.json({ trips });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApprovedSession();
    const body = createSchema.parse(await request.json());
    const id = await createTrip(session.user.id, body);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}