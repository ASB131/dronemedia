import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import {
  approvalStatusEnum,
  auditActionTypeEnum,
  inviteStatusEnum,
  userRoleEnum,
} from "./enums";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull().unique(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name"),
    bio: text("bio"),
    role: userRoleEnum("role").notNull().default("user"),
    approvalStatus: approvalStatusEnum("approval_status")
      .notNull()
      .default("pending"),
    storageQuotaBytes: bigint("storage_quota_bytes", { mode: "number" }).notNull(),
    storageUsedBytes: bigint("storage_used_bytes", { mode: "number" })
      .notNull()
      .default(0),
    inviteId: uuid("invite_id"),
    pinHash: text("pin_hash"),
    preferences: jsonb("preferences")
      .$type<{
        theme?: "light" | "dark" | "system";
        downloadOriginalDefault?: boolean;
        zipMultiSelectDefault?: boolean;
        notificationsEnabled?: boolean;
        /** Default in-player quality: HLS height or camera original ("source"). */
        defaultPlaybackResolution?:
          | "720"
          | "1080"
          | "1440"
          | "source";
        /** Viewer-chosen LUT applied to D-Log / D-Log M previews app-wide. */
        previewLutId?: string | null;
        /** Default preferred LUT for newly uploaded D-Log media. */
        defaultDLogLutId?: string | null;
        /** Default preferred LUT for newly uploaded D-Log M media. */
        defaultDLogMLutId?: string | null;
        /**
         * In-app Source (original) playback: true/false override, null/omit = inherit global.
         * Admins always retain Source regardless of this flag.
         */
        allowInAppSource?: boolean | null;
        cinematicSource?: "all" | "favorites" | "albums";
        cinematicAlbumIds?: string[];
        cinematicLutId?: string | null;
        portfolio?: {
          coverAssetId?: string | null;
          featuredAlbumIds?: string[];
          showcaseAssetIds?: string[];
          theme?: "default" | "cinematic" | "minimal";
        };
      }>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("users_approval_status_idx").on(table.approvalStatus),
    index("users_role_idx").on(table.role),
  ],
);

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: inviteStatusEnum("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    usedByUserId: uuid("used_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("invites_status_idx").on(table.status)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull(),
    label: text("label").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("api_keys_user_id_idx").on(table.userId),
    index("api_keys_key_hash_idx").on(table.keyHash),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionToken: text("session_token").notNull().unique(),
    deviceInfo: jsonb("device_info").$type<Record<string, unknown>>(),
    revoked: boolean("revoked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_last_active_at_idx").on(table.lastActiveAt),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actionType: auditActionTypeEnum("action_type").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_logs_actor_user_id_idx").on(table.actorUserId),
    index("audit_logs_action_type_idx").on(table.actionType),
    index("audit_logs_created_at_idx").on(table.createdAt),
  ],
);

export const usersRelations = relations(users, ({ many, one }) => ({
  apiKeys: many(apiKeys),
  sessions: many(sessions),
  auditLogs: many(auditLogs),
  invite: one(invites, {
    fields: [users.inviteId],
    references: [invites.id],
  }),
}));

export const invitesRelations = relations(invites, ({ one }) => ({
  createdBy: one(users, {
    fields: [invites.createdByUserId],
    references: [users.id],
  }),
  usedBy: one(users, {
    fields: [invites.usedByUserId],
    references: [users.id],
  }),
}));
