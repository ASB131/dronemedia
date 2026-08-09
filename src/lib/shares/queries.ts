import { randomBytes } from "node:crypto";

import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { hashPassword } from "@/lib/auth/password";
import { getWebDb } from "@/lib/db";
import { shareRecipients, shares, users } from "@/lib/db/schema";

export function generateShareToken() {
  return randomBytes(16).toString("hex");
}

export type ShareTargetType = "asset" | "flight" | "album";

export type ShareCreateOptions = {
  expiresAt?: Date | null;
  includeExactGps?: boolean;
  password?: string | null;
};

export type ShareDto = {
  id: string;
  token: string;
  shareType: "public" | "user";
  targetType: ShareTargetType;
  targetId: string;
  targetName: string | null;
  previewAssetId: string | null;
  expiresAt: string | null;
  hasPassword: boolean;
  includeExactGps: boolean;
  revoked: boolean;
  createdAt: string;
  shareUrl: string;
  recipients?: Array<{ userId: string; username: string }>;
};

export type ReceivedShareDto = {
  id: string;
  token: string;
  targetType: "asset" | "flight" | "album";
  targetId: string;
  shareUrl: string;
  createdAt: string;
  expiresAt: string | null;
  ownerUsername: string;
  displayName: string | null;
};

export async function listSharesForUser(
  userId: string,
  publicUrl: string,
): Promise<ShareDto[]> {
  const db = getWebDb();
  const rows = await db
    .select({
      share: shares,
      targetName: sql<string | null>`(
        case ${shares.targetType}
          when 'asset' then (
            select a.display_name from assets a
            where a.id = ${shares.targetId} limit 1
          )
          when 'album' then (
            select al.name from albums al
            where al.id = ${shares.targetId} limit 1
          )
          when 'flight' then (
            select coalesce(f.title, 'Untitled flight') from flights f
            where f.id = ${shares.targetId} limit 1
          )
          else null
        end
      )`,
      previewAssetId: sql<string | null>`(
        case ${shares.targetType}
          when 'album' then (
            select aa.asset_id
            from album_assets aa
            inner join assets a on a.id = aa.asset_id
            where aa.album_id = ${shares.targetId}
              and a.deleted_at is null
            order by aa.added_at desc
            limit 1
          )
          when 'flight' then (
            select a.id
            from assets a
            where a.flight_id = ${shares.targetId}
              and a.deleted_at is null
            order by coalesce(a.captured_at_override, a.captured_at_original) asc nulls last
            limit 1
          )
          else null
        end
      )`,
    })
    .from(shares)
    .where(eq(shares.ownerUserId, userId))
    .orderBy(desc(shares.createdAt));

  return rows.map((row) =>
    toShareDto(
      row.share,
      publicUrl,
      row.targetName,
      row.share.targetType === "asset"
        ? row.share.targetId
        : row.previewAssetId,
    ),
  );
}

async function resolvePasswordHash(password?: string | null) {
  if (!password?.trim()) return null;
  return hashPassword(password.trim());
}

export async function createPublicShare(
  userId: string,
  targetType: ShareTargetType,
  targetId: string,
  publicUrl: string,
  options?: ShareCreateOptions,
) {
  const db = getWebDb();
  const [share] = await db
    .insert(shares)
    .values({
      token: generateShareToken(),
      ownerUserId: userId,
      shareType: "public",
      targetType,
      targetId,
      expiresAt: options?.expiresAt ?? null,
      passwordHash: await resolvePasswordHash(options?.password),
      includeExactGps: options?.includeExactGps ?? false,
    })
    .returning();

  return toShareDto(share, publicUrl);
}

/** @deprecated Use createPublicShare */
export async function createPublicAssetShare(
  userId: string,
  assetId: string,
  publicUrl: string,
  options?: ShareCreateOptions,
) {
  return createPublicShare(userId, "asset", assetId, publicUrl, options);
}

export async function createUserShare(
  ownerUserId: string,
  targetType: ShareTargetType,
  targetId: string,
  recipientUsernames: string[],
  publicUrl: string,
  options?: ShareCreateOptions,
) {
  const db = getWebDb();
  const normalized = [
    ...new Set(
      recipientUsernames
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];

  if (normalized.length === 0) {
    throw new Error("At least one recipient is required");
  }

  const recipients = await db
    .select({
      id: users.id,
      username: users.username,
    })
    .from(users)
    .where(
      and(
        inArray(sql`lower(${users.username})`, normalized),
        eq(users.approvalStatus, "approved"),
        ne(users.id, ownerUserId),
      ),
    );

  if (recipients.length === 0) {
    throw new Error("No matching approved users found");
  }

  const [share] = await db
    .insert(shares)
    .values({
      token: generateShareToken(),
      ownerUserId,
      shareType: "user",
      targetType,
      targetId,
      expiresAt: options?.expiresAt ?? null,
      passwordHash: await resolvePasswordHash(options?.password),
      includeExactGps: options?.includeExactGps ?? false,
    })
    .returning();

  await db.insert(shareRecipients).values(
    recipients.map((recipient) => ({
      shareId: share.id,
      recipientUserId: recipient.id,
    })),
  );

  return {
    ...toShareDto(share, publicUrl),
    recipients: recipients.map((recipient) => ({
      userId: recipient.id,
      username: recipient.username,
    })),
  };
}

/** @deprecated Use createUserShare */
export async function createUserAssetShare(
  ownerUserId: string,
  assetId: string,
  recipientUsernames: string[],
  publicUrl: string,
  options?: ShareCreateOptions,
) {
  return createUserShare(
    ownerUserId,
    "asset",
    assetId,
    recipientUsernames,
    publicUrl,
    options,
  );
}

export async function listSharesReceivedByUser(
  userId: string,
  publicUrl: string,
): Promise<ReceivedShareDto[]> {
  const db = getWebDb();
  const rows = await db
    .select({
      id: shares.id,
      token: shares.token,
      targetType: shares.targetType,
      targetId: shares.targetId,
      createdAt: shares.createdAt,
      expiresAt: shares.expiresAt,
      ownerUsername: users.username,
      displayName: sql<string | null>`(
        select a.display_name from assets a
        where a.id = ${shares.targetId} and a.deleted_at is null
        limit 1
      )`,
    })
    .from(shareRecipients)
    .innerJoin(shares, eq(shareRecipients.shareId, shares.id))
    .innerJoin(users, eq(shares.ownerUserId, users.id))
    .where(
      and(
        eq(shareRecipients.recipientUserId, userId),
        eq(shares.revoked, false),
        eq(shares.shareType, "user"),
      ),
    )
    .orderBy(desc(shares.createdAt));

  const now = Date.now();
  return rows
    .filter((row) => !row.expiresAt || row.expiresAt.getTime() >= now)
    .map((row) => ({
      id: row.id,
      token: row.token,
      targetType: row.targetType,
      targetId: row.targetId,
      shareUrl: `${publicUrl.replace(/\/$/, "")}/share/${row.token}`,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      ownerUsername: row.ownerUsername,
      displayName: row.displayName,
    }));
}

export async function isShareRecipient(shareId: string, userId: string) {
  const db = getWebDb();
  const [row] = await db
    .select({ shareId: shareRecipients.shareId })
    .from(shareRecipients)
    .where(
      and(
        eq(shareRecipients.shareId, shareId),
        eq(shareRecipients.recipientUserId, userId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function searchApprovedUsers(
  query: string,
  excludeUserId: string,
  limit = 10,
) {
  const db = getWebDb();
  const trimmed = query.trim().toLowerCase();

  return db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
    })
    .from(users)
    .where(
      and(
        eq(users.approvalStatus, "approved"),
        ne(users.id, excludeUserId),
        trimmed
          ? sql`(
              lower(${users.username}) like ${`${trimmed}%`}
              or lower(coalesce(${users.displayName}, '')) like ${`%${trimmed}%`}
            )`
          : undefined,
      ),
    )
    .orderBy(users.username)
    .limit(limit);
}

export async function revokeShare(userId: string, shareId: string) {
  const db = getWebDb();
  const [share] = await db
    .update(shares)
    .set({ revoked: true, revokedAt: new Date() })
    .where(and(eq(shares.id, shareId), eq(shares.ownerUserId, userId)))
    .returning();

  return share ?? null;
}

export async function updateShare(
  userId: string,
  shareId: string,
  publicUrl: string,
  input: {
    expiresAt?: Date | null;
    password?: string | null;
    includeExactGps?: boolean;
  },
) {
  const db = getWebDb();
  const [existing] = await db
    .select()
    .from(shares)
    .where(
      and(
        eq(shares.id, shareId),
        eq(shares.ownerUserId, userId),
        eq(shares.revoked, false),
      ),
    )
    .limit(1);

  if (!existing) return null;

  const patch: Partial<typeof shares.$inferInsert> = {};
  if ("expiresAt" in input) {
    patch.expiresAt = input.expiresAt ?? null;
  }
  if ("includeExactGps" in input && typeof input.includeExactGps === "boolean") {
    patch.includeExactGps = input.includeExactGps;
  }
  if ("password" in input) {
    if (input.password == null || input.password === "") {
      patch.passwordHash = null;
    } else {
      patch.passwordHash = await hashPassword(input.password);
    }
  }

  if (Object.keys(patch).length === 0) {
    return toShareDto(existing, publicUrl);
  }

  const [updated] = await db
    .update(shares)
    .set(patch)
    .where(eq(shares.id, shareId))
    .returning();

  return updated ? toShareDto(updated, publicUrl) : null;
}

export async function getActiveShareByToken(token: string) {
  const db = getWebDb();
  const [share] = await db
    .select()
    .from(shares)
    .where(and(eq(shares.token, token), eq(shares.revoked, false)))
    .limit(1);

  if (!share) return null;
  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) return null;

  return share;
}

function toShareDto(
  row: typeof shares.$inferSelect,
  publicUrl: string,
  targetName: string | null = null,
  previewAssetId: string | null = null,
): ShareDto {
  return {
    id: row.id,
    token: row.token,
    shareType: row.shareType,
    targetType: row.targetType,
    targetId: row.targetId,
    targetName,
    previewAssetId,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    hasPassword: Boolean(row.passwordHash),
    includeExactGps: row.includeExactGps,
    revoked: row.revoked,
    createdAt: row.createdAt.toISOString(),
    shareUrl: `${publicUrl.replace(/\/$/, "")}/share/${row.token}`,
  };
}
