import { NextResponse } from "next/server";

import { jsonError, requireAdminSession } from "@/lib/api/auth";
import { getLibraryHealthSummary } from "@/lib/admin/library-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminSession();
    const summary = await getLibraryHealthSummary();
    return NextResponse.json(summary);
  } catch (error) {
    return jsonError(error);
  }
}
