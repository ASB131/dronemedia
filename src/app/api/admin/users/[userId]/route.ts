import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, requireAdminSession } from "@/lib/api/auth";
import { getWebDb } from "@/lib/db";
import { auditLogs, users } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    approvalStatus: z.enum(["approved", "rejected"]).optional(),
    asDisable: z.boolean().optional(),
    storageQuotaBytes: z.number().int().positive().max(1024 ** 4).optional(),
  })
  .refine(
    (body) =>
      body.approvalStatus !== undefined || body.storageQuotaBytes !== undefined,
    { message: "Nothing to update" },
  );

export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    const session = await requireAdminSession();
    const { userId } = await context.params;
    const body = bodySchema.parse(await request.json());
    const db = getWebDb();

    const [target] = await db
      .select({
        id: users.id,
        role: users.role,
        approvalStatus: users.approvalStatus,
        storageQuotaBytes: users.storageQuotaBytes,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (
      target.role === "admin" &&
      body.approvalStatus === "rejected"
    ) {
      return NextResponse.json(
        { error: "Cannot disable or reject an admin account" },
        { status: 400 },
      );
    }

    const updates: {
      approvalStatus?: "approved" | "rejected";
      storageQuotaBytes?: number;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (body.approvalStatus !== undefined) {
      updates.approvalStatus = body.approvalStatus;
    }
    if (body.storageQuotaBytes !== undefined) {
      updates.storageQuotaBytes = body.storageQuotaBytes;
    }

    await db.update(users).set(updates).where(eq(users.id, userId));

    if (body.approvalStatus !== undefined) {
      let actionType: "user.approve" | "user.reject" | "user.disable" =
        body.approvalStatus === "approved" ? "user.approve" : "user.reject";
      if (body.approvalStatus === "rejected" && body.asDisable) {
        actionType = "user.disable";
      }

      await db.insert(auditLogs).values({
        actorUserId: session.user.id,
        actionType,
        targetType: "user",
        targetId: userId,
        metadata: {
          previousStatus: target.approvalStatus,
          nextStatus: body.approvalStatus,
        },
      });
    }

    if (
      body.storageQuotaBytes !== undefined &&
      body.storageQuotaBytes !== target.storageQuotaBytes
    ) {
      await db.insert(auditLogs).values({
        actorUserId: session.user.id,
        actionType: "user.quota_change",
        targetType: "user",
        targetId: userId,
        metadata: {
          previousQuotaBytes: target.storageQuotaBytes,
          nextQuotaBytes: body.storageQuotaBytes,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    const session = await requireAdminSession();
    const { userId } = await context.params;
    const db = getWebDb();

    if (userId === session.user.id) {
      return NextResponse.json(
        { error: "Cannot delete your own account" },
        { status: 400 },
      );
    }

    const [target] = await db
      .select({
        id: users.id,
        role: users.role,
        username: users.username,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (target.role === "admin") {
      return NextResponse.json(
        { error: "Cannot delete an admin account" },
        { status: 400 },
      );
    }

    await db.insert(auditLogs).values({
      actorUserId: session.user.id,
      actionType: "user.delete",
      targetType: "user",
      targetId: userId,
      metadata: { username: target.username },
    });

    await db.delete(users).where(eq(users.id, userId));

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
