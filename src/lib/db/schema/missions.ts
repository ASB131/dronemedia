import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { albums } from "./albums";
import { drones } from "./drones";
import { geometryPoint } from "./postgis";
import { users } from "./users";

export type MissionChecklistItem = {
  id: string;
  label: string;
  required?: boolean;
};

export const siteNotes = pgTable(
  "site_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    note: text("note"),
    location: geometryPoint("location").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("site_notes_user_id_idx").on(table.userId)],
);

export const missionTemplates = pgTable(
  "mission_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    checklist: jsonb("checklist")
      .$type<MissionChecklistItem[]>()
      .notNull()
      .default([]),
    requireSrt: boolean("require_srt").notNull().default(false),
    requireLrf: boolean("require_lrf").notNull().default(false),
    defaultDroneId: uuid("default_drone_id").references(() => drones.id, {
      onDelete: "set null",
    }),
    defaultAlbumId: uuid("default_album_id").references(() => albums.id, {
      onDelete: "set null",
    }),
    defaultTags: text("default_tags").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("mission_templates_user_id_idx").on(table.userId)],
);

export const siteNotesRelations = relations(siteNotes, ({ one }) => ({
  user: one(users, {
    fields: [siteNotes.userId],
    references: [users.id],
  }),
}));

export const missionTemplatesRelations = relations(
  missionTemplates,
  ({ one }) => ({
    user: one(users, {
      fields: [missionTemplates.userId],
      references: [users.id],
    }),
    defaultDrone: one(drones, {
      fields: [missionTemplates.defaultDroneId],
      references: [drones.id],
    }),
    defaultAlbum: one(albums, {
      fields: [missionTemplates.defaultAlbumId],
      references: [albums.id],
    }),
  }),
);
