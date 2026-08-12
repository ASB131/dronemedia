import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

import { jsonError, requireAdminSession } from "@/lib/api/auth";
import { getWebDb } from "@/lib/db";
import { users } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminSession();
    const db = getWebDb();
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        approvalStatus: users.approvalStatus,
        storageUsedBytes: users.storageUsedBytes,
        storageQuotaBytes: users.storageQuotaBytes,
        preferences: users.preferences,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));

    return NextResponse.json({
      users: rows.map((user) => ({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        approvalStatus: user.approvalStatus,
        storageUsedBytes: user.storageUsedBytes,
        storageQuotaBytes: user.storageQuotaBytes,
        allowInAppSource: user.preferences?.allowInAppSource ?? null,
        createdAt: user.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
