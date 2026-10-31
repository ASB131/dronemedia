import { NextResponse } from "next/server";

import { jsonError, requireApprovedSessionOrApiKey } from "@/lib/api/auth";
import { revokeDbSession } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await requireApprovedSessionOrApiKey(request);
    const header = request.headers.get("authorization");
    if (header?.toLowerCase().startsWith("bearer ")) {
      const token = header.slice(7).trim();
      if (!token.startsWith("dm_")) {
        await revokeDbSession(token);
      }
    }
    return NextResponse.json({ ok: true, username: session.user.username });
  } catch (error) {
    return jsonError(error);
  }
}
