import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { shareTargetTypeEnum, shareTypeEnum } from "./enums";
import { users } from "./users";

export const shares = pgTable(
  "shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull().unique(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    shareType: shareTypeEnum("share_type").notNull(),
    targetType: shareTargetTypeEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    passwordHash: text("password_hash"),
    includeExactGps: boolean("include_exact_gps").notNull().default(false),
    revoked: boolean("revoked").notNull().default(false),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("shares_owner_user_id_idx").on(table.ownerUserId),
    index("shares_target_idx").on(table.targetType, table.targetId),
    index("shares_revoked_idx").on(table.revoked),
    uniqueIndex("shares_token_uidx").on(table.token),
  ],
);

export const shareRecipients = pgTable(
  "share_recipients",
  {
    shareId: uuid("share_id")
      .notNull()
      .references(() => shares.id, { onDelete: "cascade" }),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.shareId, table.recipientUserId] }),
    index("share_recipients_recipient_user_id_idx").on(table.recipientUserId),
  ],
);

export const sharesRelations = relations(shares, ({ one, many }) => ({
  owner: one(users, {
    fields: [shares.ownerUserId],
    references: [users.id],
  }),
  recipients: many(shareRecipients),
}));

export const shareRecipientsRelations = relations(
  shareRecipients,
  ({ one }) => ({
    share: one(shares, {
      fields: [shareRecipients.shareId],
      references: [shares.id],
    }),
    recipient: one(users, {
      fields: [shareRecipients.recipientUserId],
      references: [users.id],
    }),
  }),
);
