import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { MediaMetadata } from "@/lib/assets/media-metadata";
import { drones } from "./drones";
import {
  assetTypeEnum,
  chapterSourceEnum,
  flightGroupingMethodEnum,
  sequenceKindEnum,
} from "./enums";
import { luts } from "./luts";
import { geometryPoint, tsvector } from "./postgis";
import { users } from "./users";

export const flights = pgTable(
  "flights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    droneId: uuid("drone_id").references(() => drones.id, {
      onDelete: "set null",
    }),
    title: text("title"),
    startTime: timestamp("start_time", { withTimezone: true, mode: "date" }),
    endTime: timestamp("end_time", { withTimezone: true, mode: "date" }),
    totalDistanceMeters: numeric("total_distance_meters"),
    maxAltitudeMeters: numeric("max_altitude_meters"),
    totalDurationSeconds: numeric("total_duration_seconds"),
    groupingMethod: flightGroupingMethodEnum("grouping_method")
      .notNull()
      .default("auto"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("flights_user_id_idx").on(table.userId),
    index("flights_drone_id_idx").on(table.droneId),
    index("flights_start_time_idx").on(table.startTime),
  ],
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    assetType: assetTypeEnum("asset_type").notNull(),
    mainFileExt: text("main_file_ext").notNull(),
    hasSrt: boolean("has_srt").notNull().default(false),
    hasLrf: boolean("has_lrf").notNull().default(false),
    hasProxy: boolean("has_proxy").notNull().default(false),
    hasHls: boolean("has_hls").notNull().default(false),
    favorite: boolean("favorite").notNull().default(false),
    isPublic: boolean("is_public").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    contentHash: text("content_hash"),
    perceptualHash: text("perceptual_hash"),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    description: text("description"),
    tags: text("tags").array().notNull().default([]),
    capturedAtOriginal: timestamp("captured_at_original", {
      withTimezone: true,
      mode: "date",
    }),
    capturedAtOverride: timestamp("captured_at_override", {
      withTimezone: true,
      mode: "date",
    }),
    capturedTimezone: text("captured_timezone"),
    locationOriginal: geometryPoint("location_original"),
    locationOverride: geometryPoint("location_override"),
    mediaMetadata: jsonb("media_metadata").$type<MediaMetadata>(),
    droneId: uuid("drone_id").references(() => drones.id, {
      onDelete: "set null",
    }),
    flightId: uuid("flight_id").references(() => flights.id, {
      onDelete: "set null",
    }),
    sequenceKind: sequenceKindEnum("sequence_kind"),
    frameCount: integer("frame_count"),
    sequenceFolder: text("sequence_folder"),
    /** Playback / export frame rate for sequence assets (fps). */
    sequenceFps: real("sequence_fps"),
    /** Client-side preview LUT (admin-managed .cube). */
    preferredLutId: uuid("preferred_lut_id").references(() => luts.id, {
      onDelete: "set null",
    }),
    searchVector: tsvector("search_vector"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("assets_user_id_idx").on(table.userId),
    index("assets_flight_id_idx").on(table.flightId),
    index("assets_drone_id_idx").on(table.droneId),
    index("assets_deleted_at_idx").on(table.deletedAt),
    index("assets_favorite_idx").on(table.favorite),
    index("assets_is_public_idx").on(table.isPublic),
    index("assets_user_public_idx").on(table.userId, table.isPublic),
    index("assets_captured_at_original_idx").on(table.capturedAtOriginal),
    index("assets_content_hash_idx").on(table.contentHash),
    index("assets_perceptual_hash_idx").on(table.perceptualHash),
    index("assets_preferred_lut_id_idx").on(table.preferredLutId),
    index("assets_tags_idx").using("gin", table.tags),
  ],
);

export const assetFiles = pgTable(
  "asset_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    extension: text("extension").notNull(),
    contentHash: text("content_hash").notNull(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("asset_files_asset_id_idx").on(table.assetId),
    index("asset_files_content_hash_idx").on(table.contentHash),
    uniqueIndex("asset_files_user_content_hash_uidx").on(
      table.userId,
      table.contentHash,
    ),
    uniqueIndex("asset_files_asset_extension_uidx").on(
      table.assetId,
      table.extension,
    ),
  ],
);

export const videoChapters = pgTable(
  "video_chapters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    timestampOffsetMs: integer("timestamp_offset_ms").notNull(),
    label: text("label").notNull(),
    source: chapterSourceEnum("source").notNull().default("auto"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("video_chapters_asset_id_idx").on(table.assetId),
    index("video_chapters_asset_timestamp_idx").on(
      table.assetId,
      table.timestampOffsetMs,
    ),
  ],
);

export const sequenceFrames = pgTable(
  "sequence_frames",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    frameIndex: integer("frame_index").notNull(),
    filename: text("filename").notNull(),
    storageKey: text("storage_key").notNull(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
    contentHash: text("content_hash").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" }),
    location: geometryPoint("location"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sequence_frames_asset_id_idx").on(table.assetId),
    index("sequence_frames_user_id_idx").on(table.userId),
    uniqueIndex("sequence_frames_asset_index_uidx").on(
      table.assetId,
      table.frameIndex,
    ),
  ],
);

export const flightsRelations = relations(flights, ({ one, many }) => ({
  user: one(users, {
    fields: [flights.userId],
    references: [users.id],
  }),
  drone: one(drones, {
    fields: [flights.droneId],
    references: [drones.id],
  }),
  assets: many(assets),
}));

export const assetsRelations = relations(assets, ({ one, many }) => ({
  user: one(users, {
    fields: [assets.userId],
    references: [users.id],
  }),
  drone: one(drones, {
    fields: [assets.droneId],
    references: [drones.id],
  }),
  flight: one(flights, {
    fields: [assets.flightId],
    references: [flights.id],
  }),
  preferredLut: one(luts, {
    fields: [assets.preferredLutId],
    references: [luts.id],
  }),
  files: many(assetFiles),
  chapters: many(videoChapters),
  sequenceFrames: many(sequenceFrames),
}));

export const assetFilesRelations = relations(assetFiles, ({ one }) => ({
  asset: one(assets, {
    fields: [assetFiles.assetId],
    references: [assets.id],
  }),
  user: one(users, {
    fields: [assetFiles.userId],
    references: [users.id],
  }),
}));

export const videoChaptersRelations = relations(videoChapters, ({ one }) => ({
  asset: one(assets, {
    fields: [videoChapters.assetId],
    references: [assets.id],
  }),
}));

export const sequenceFramesRelations = relations(sequenceFrames, ({ one }) => ({
  asset: one(assets, {
    fields: [sequenceFrames.assetId],
    references: [assets.id],
  }),
  user: one(users, {
    fields: [sequenceFrames.userId],
    references: [users.id],
  }),
}));
