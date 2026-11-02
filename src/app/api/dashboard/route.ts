import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { getDashboardPayload } from "@/lib/dashboard/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireApprovedSession();
    const payload = await getDashboardPayload(session.user.id);
    return NextResponse.json(payload);
  } catch (error) {
    return jsonError(error);
  }
}
