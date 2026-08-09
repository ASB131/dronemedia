import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { checkForUpdates } from "@/lib/version/check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireApprovedSession();
    return NextResponse.json(await checkForUpdates());
  } catch (error) {
    return jsonError(error);
  }
}
