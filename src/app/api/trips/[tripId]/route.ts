import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import {
  deleteTrip,
  getTripForUser,
  updateTrip,
} from "@/lib/trips/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  startDate: z.string().min(10).max(10).optional(),
  endDate: z.string().min(10).max(10).optional(),
  coverAssetId: z.string().uuid().nullable().optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { tripId } = await context.params;
    const trip = await getTripForUser(session.user.id, tripId);
    if (!trip) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ trip });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { tripId } = await context.params;
    const body = patchSchema.parse(await request.json());
    const updated = await updateTrip(session.user.id, tripId, body);
    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const trip = await getTripForUser(session.user.id, tripId);
    return NextResponse.json({ trip });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { tripId } = await context.params;
    const ok = await deleteTrip(session.user.id, tripId);
    if (!ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return jsonError(error);
  }
}