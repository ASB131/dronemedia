import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { listSiteNotes } from "@/lib/sites/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireApprovedSession();
    const sites = await listSiteNotes(session.user.id);
    return NextResponse.json({ sites });
  } catch (error) {
    return jsonError(error);
  }
}
