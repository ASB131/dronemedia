import { relations } from "drizzle-orm";
import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { assets } from "./assets";
import { albumMemberRoleEnum } from "./enums";
import { users } from "./users";

export const albums = pgTable(
  "albums",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("albums_user_id_idx").on(table.userId)],
);

export const albumAssets = pgTable(
  "album_assets",
  {
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.albumId, table.assetId] }),
    index("album_assets_asset_id_idx").on(table.assetId),
  ],
);

export const albumMembers = pgTable(
  "album_members",
  {
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: albumMemberRoleEnum("role").notNull().default("viewer"),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.albumId, table.userId] }),
    index("album_members_user_id_idx").on(table.userId),
  ],
);

export const albumsRelations = relations(albums, ({ one, many }) => ({
  user: one(users, {
    fields: [albums.userId],
    references: [users.id],
  }),
  albumAssets: many(albumAssets),
  members: many(albumMembers),
}));

export const albumAssetsRelations = relations(albumAssets, ({ one }) => ({
  album: one(albums, {
    fields: [albumAssets.albumId],
    references: [albums.id],
  }),
  asset: one(assets, {
    fields: [albumAssets.assetId],
    references: [assets.id],
  }),
}));

export const albumMembersRelations = relations(albumMembers, ({ one }) => ({
  album: one(albums, {
    fields: [albumMembers.albumId],
    references: [albums.id],
  }),
  user: one(users, {
    fields: [albumMembers.userId],
    references: [users.id],
  }),
}));
