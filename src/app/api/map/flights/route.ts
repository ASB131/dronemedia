import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { listMapFlightPathsForUser } from "@/lib/map/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireApprovedSession();
    const flights = await listMapFlightPathsForUser(session.user.id);
    return NextResponse.json({ flights });
  } catch (error) {
    return jsonError(error);
  }
}
