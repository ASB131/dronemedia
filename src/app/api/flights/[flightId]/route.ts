import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { getFlightForUser } from "@/lib/flights/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ flightId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { flightId } = await context.params;
    const flight = await getFlightForUser(session.user.id, flightId);

    if (!flight) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ flight });
  } catch (error) {
    return jsonError(error);
  }
}
