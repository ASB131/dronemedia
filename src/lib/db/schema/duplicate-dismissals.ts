import { relations } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./users";

export const duplicateDismissals = pgTable(
  "duplicate_dismissals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** exact = content hash group; near = perceptual group */
    kind: text("kind").notNull(),
    groupKey: text("group_key").notNull(),
    /** Sorted asset ids — dismiss lifts when membership changes. */
    memberFingerprint: text("member_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("duplicate_dismissals_user_kind_key_uidx").on(
      table.userId,
      table.kind,
      table.groupKey,
    ),
    index("duplicate_dismissals_user_idx").on(table.userId),
  ],
);

export const duplicateDismissalsRelations = relations(
  duplicateDismissals,
  ({ one }) => ({
    user: one(users, {
      fields: [duplicateDismissals.userId],
      references: [users.id],
    }),
  }),
);

export function duplicateMemberFingerprint(assetIds: string[]) {
  return [...assetIds].sort().join(",");
}
