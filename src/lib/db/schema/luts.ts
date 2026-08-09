import { relations } from "drizzle-orm";
import {
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { lutColorProfileEnum } from "./enums";
import { users } from "./users";

export const luts = pgTable(
  "luts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    colorProfile: lutColorProfileEnum("color_profile").notNull().default("d_log"),
    storageKey: text("storage_key").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("luts_created_at_idx").on(table.createdAt),
    index("luts_name_idx").on(table.name),
    index("luts_color_profile_idx").on(table.colorProfile),
  ],
);
export const lutsRelations = relations(luts, ({ one }) => ({
  creator: one(users, {
    fields: [luts.createdBy],
    references: [users.id],
  }),
}));
