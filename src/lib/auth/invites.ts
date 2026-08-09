import { randomBytes } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import { getWebDb } from "@/lib/db";
import { invites } from "@/lib/db/schema";

export function generateInviteCode() {
  return randomBytes(8).toString("hex");
}

export async function validateInviteCode(code: string) {
  const db = getWebDb();
  const rows = await db
    .select()
    .from(invites)
    .where(and(eq(invites.code, code.trim()), eq(invites.status, "active")))
    .limit(1);

  const invite = rows[0];
  if (!invite) {
    return { ok: false as const, error: "Invalid or expired invite code." };
  }

  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    return { ok: false as const, error: "This invite code has expired." };
  }

  return { ok: true as const, invite };
}

export async function markInviteUsed(inviteId: string, userId: string) {
  const db = getWebDb();
  await db
    .update(invites)
    .set({ status: "used", usedByUserId: userId })
    .where(eq(invites.id, inviteId));
}

export async function listInvites() {
  const db = getWebDb();
  return db.select().from(invites).orderBy(desc(invites.createdAt));
}

export async function createInvite(createdByUserId: string, expiresAt?: Date) {
  const db = getWebDb();
  const [invite] = await db
    .insert(invites)
    .values({
      code: generateInviteCode(),
      createdByUserId,
      expiresAt: expiresAt ?? null,
    })
    .returning();

  return invite;
}

export async function revokeInvite(inviteId: string) {
  const db = getWebDb();
  const [invite] = await db
    .update(invites)
    .set({ status: "revoked" })
    .where(and(eq(invites.id, inviteId), eq(invites.status, "active")))
    .returning();

  return invite ?? null;
}
