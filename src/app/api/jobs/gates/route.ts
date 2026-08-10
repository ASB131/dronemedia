import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { getJobGates } from "@/lib/jobs/gates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public-to-authenticated: whether heavy jobs are currently enabled. */
export async function GET() {
  try {
    await requireApprovedSession();
    return NextResponse.json({ gates: getJobGates(true) });
  } catch (error) {
    return jsonError(error);
  }
}
