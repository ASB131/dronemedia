import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { listMapAssetsForUser } from "@/lib/map/queries";
import { requireTripDates } from "@/lib/trips/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { tripId } = await context.params;
    const { startDate, endDate } = await requireTripDates(
      session.user.id,
      tripId,
    );
    const assets = await listMapAssetsForUser(session.user.id, {
      captureDateFrom: startDate,
      captureDateTo: endDate,
      limit: 2000,
    });
    return NextResponse.json({ assets, count: assets.length });
  } catch (error) {
    return jsonError(error);
  }
}