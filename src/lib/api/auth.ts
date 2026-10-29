import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { findUserById } from "@/lib/auth/users";
import { getWebDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { reconcileUserStorageUsed } from "@/lib/users/storage-usage";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function requireApprovedSession() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new ApiError(401, "Unauthorized");
  }

  // Fail closed on stale JWTs: re-read approval/role from the database.
  const dbUser = await findUserById(session.user.id);
  if (!dbUser || dbUser.approvalStatus !== "approved") {
    throw new ApiError(403, "Account not approved");
  }

  session.user.role = dbUser.role;
  session.user.approvalStatus = dbUser.approvalStatus;
  session.user.username = dbUser.username;
  return session;
}

export async function requireAdminSession() {
  const session = await requireApprovedSession();
  if (session.user.role !== "admin") {
    throw new ApiError(403, "Admin access required");
  }
  return session;
}

export async function getUserStorage(userId: string) {
  const db = getWebDb();
  const rows = await db
    .select({
      storageQuotaBytes: users.storageQuotaBytes,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;

  const usedBytes = await reconcileUserStorageUsed(userId, db);
  return {
    storageQuotaBytes: row.storageQuotaBytes,
    storageUsedBytes: usedBytes,
  };
}

export function assertWithinQuota(
  usedBytes: number,
  quotaBytes: number,
  incomingBytes: number,
): void {
  if (usedBytes + incomingBytes > quotaBytes) {
    throw new ApiError(413, "Storage quota exceeded");
  }
}

export function jsonError(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
