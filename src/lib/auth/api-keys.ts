import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, isNull } from "drizzle-orm";

import { getWebDb } from "@/lib/db";
import { apiKeys, sessions } from "@/lib/db/schema";

export function hashApiKey(rawKey: string) {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function generateApiKeySecret() {
  const raw = `dm_${randomBytes(24).toString("base64url")}`;
  return { raw, hash: hashApiKey(raw) };
}

export async function listApiKeysForUser(userId: string) {
  const db = getWebDb();
  return db
    .select({
      id: apiKeys.id,
      label: apiKeys.label,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt));
}

export async function createApiKey(userId: string, label: string) {
  const db = getWebDb();
  const { raw, hash } = generateApiKeySecret();
  const [row] = await db
    .insert(apiKeys)
    .values({
      userId,
      label,
      keyHash: hash,
    })
    .returning({
      id: apiKeys.id,
      label: apiKeys.label,
      createdAt: apiKeys.createdAt,
    });
  return { key: row, raw };
}

export async function revokeApiKey(userId: string, keyId: string) {
  const db = getWebDb();
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
    .returning({ id: apiKeys.id });
  return row ?? null;
}

export async function listDevicesForUser(userId: string) {
  const db = getWebDb();
  return db
    .select({
      id: sessions.id,
      deviceInfo: sessions.deviceInfo,
      revoked: sessions.revoked,
      createdAt: sessions.createdAt,
      lastActiveAt: sessions.lastActiveAt,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.lastActiveAt))
    .limit(50);
}

export async function revokeDevice(userId: string, sessionId: string) {
  const db = getWebDb();
  const [row] = await db
    .update(sessions)
    .set({ revoked: true })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .returning({ id: sessions.id });
  return row ?? null;
}
