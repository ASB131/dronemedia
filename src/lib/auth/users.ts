import { eq, or, sql } from "drizzle-orm";

import { loadConfig } from "@/lib/config";
import { getWebDb } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";

let adminExistsCache: { value: boolean; expiresAt: number } | null = null;

export function invalidateAdminExistsCache(): void {
  adminExistsCache = null;
}

export async function adminExists(): Promise<boolean> {
  if (adminExistsCache && adminExistsCache.expiresAt > Date.now()) {
    return adminExistsCache.value;
  }

  const db = getWebDb();
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "admin"))
    .limit(1);

  const value = rows.length > 0;
  adminExistsCache = { value, expiresAt: Date.now() + 10_000 };
  return value;
}

export async function findUserByUsernameOrEmail(identifier: string) {
  const db = getWebDb();
  const normalized = identifier.trim().toLowerCase();
  const rows = await db
    .select()
    .from(users)
    .where(
      or(
        eq(sql`lower(${users.username})`, normalized),
        eq(sql`lower(${users.email})`, normalized),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function findUserById(userId: string) {
  const db = getWebDb();
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export async function createDbSession(
  userId: string,
  sessionToken: string,
  deviceInfo?: Record<string, unknown>,
): Promise<void> {
  const db = getWebDb();
  await db.insert(sessions).values({
    userId,
    sessionToken,
    deviceInfo: deviceInfo ?? {},
  });
}

export async function revokeDbSession(sessionToken: string): Promise<void> {
  const db = getWebDb();
  await db
    .update(sessions)
    .set({ revoked: true })
    .where(eq(sessions.sessionToken, sessionToken));
}

export type SetupAdminInput = {
  username: string;
  email: string;
  passwordHash: string;
};

/** Atomically create the first admin account (setup wizard). */
export async function createFirstAdmin(input: SetupAdminInput) {
  const config = loadConfig();
  const db = getWebDb();

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('drone_media_setup'))`);

    const existing = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "admin"))
      .limit(1);

    if (existing.length > 0) {
      throw new Error("SETUP_ALREADY_COMPLETE");
    }

    const [admin] = await tx
      .insert(users)
      .values({
        username: input.username,
        email: input.email.toLowerCase(),
        passwordHash: input.passwordHash,
        role: "admin",
        approvalStatus: "approved",
        storageQuotaBytes: config.users.defaultStorageQuotaBytes,
      })
      .returning();

    invalidateAdminExistsCache();
    return admin;
  });
}

export type RegisterUserInput = {
  username: string;
  email: string;
  passwordHash: string;
  inviteId?: string;
};

export async function registerUser(input: RegisterUserInput) {
  const config = loadConfig();
  const db = getWebDb();

  if (!(await adminExists())) {
    throw new Error("SETUP_REQUIRED");
  }

  const [user] = await db
    .insert(users)
    .values({
      username: input.username,
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      role: "user",
      approvalStatus: "pending",
      storageQuotaBytes: config.users.defaultStorageQuotaBytes,
      inviteId: input.inviteId ?? null,
    })
    .returning();

  return user;
}
