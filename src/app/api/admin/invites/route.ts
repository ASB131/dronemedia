import { NextResponse } from "next/server";

import { createInvite, listInvites } from "@/lib/auth/invites";
import { jsonError, requireAdminSession } from "@/lib/api/auth";
import { getWebDb } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminSession();
    const rows = await listInvites();
    return NextResponse.json({
      invites: rows.map((invite) => ({
        id: invite.id,
        code: invite.code,
        status: invite.status,
        expiresAt: invite.expiresAt?.toISOString() ?? null,
        createdAt: invite.createdAt.toISOString(),
        usedByUserId: invite.usedByUserId,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST() {
  try {
    const session = await requireAdminSession();
    const invite = await createInvite(session.user.id);
    const db = getWebDb();

    await db.insert(auditLogs).values({
      actorUserId: session.user.id,
      actionType: "invite.create",
      targetType: "invite",
      targetId: invite.id,
      metadata: { code: invite.code },
    });

    return NextResponse.json({ invite }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
