import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { listFlightsForUser } from "@/lib/flights/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireApprovedSession();
    const flights = await listFlightsForUser(session.user.id);
    return NextResponse.json({ flights });
  } catch (error) {
    return jsonError(error);
  }
}
