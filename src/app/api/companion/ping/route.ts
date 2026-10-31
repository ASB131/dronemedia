import { NextResponse } from "next/server";

import { jsonError, requireApprovedSessionOrApiKey } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await requireApprovedSessionOrApiKey(request);
    return NextResponse.json({
      ok: true,
      username: session.user.username ?? null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
