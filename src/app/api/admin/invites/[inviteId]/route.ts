import { NextResponse } from "next/server";

import { revokeInvite } from "@/lib/auth/invites";
import { jsonError, requireAdminSession } from "@/lib/api/auth";
import { getWebDb } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  _request: Request,
  context: { params: Promise<{ inviteId: string }> },
) {
  try {
    const session = await requireAdminSession();
    const { inviteId } = await context.params;
    const invite = await revokeInvite(inviteId);

    if (!invite) {
      return NextResponse.json({ error: "Not found or not active" }, { status: 404 });
    }

    const db = getWebDb();
    await db.insert(auditLogs).values({
      actorUserId: session.user.id,
      actionType: "invite.revoke",
      targetType: "invite",
      targetId: inviteId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
