import { relations } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { assets } from "./assets";
import { uploadBatchStatusEnum, uploadFileStatusEnum } from "./upload-enums";
import { users } from "./users";

export const uploadBatches = pgTable(
  "upload_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: uploadBatchStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    committedAt: timestamp("committed_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    index("upload_batches_user_id_idx").on(table.userId),
    index("upload_batches_status_idx").on(table.status),
  ],
);

export const uploadFiles = pgTable(
  "upload_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => uploadBatches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    displayName: text("display_name").notNull(),
    basename: text("basename").notNull(),
    extension: text("extension").notNull(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
    receivedBytes: bigint("received_bytes", { mode: "number" })
      .notNull()
      .default(0),
    chunkSizeBytes: integer("chunk_size_bytes").notNull(),
    totalChunks: integer("total_chunks").notNull(),
    uploadedChunkIndices: jsonb("uploaded_chunk_indices")
      .$type<number[]>()
      .notNull()
      .default([]),
    status: uploadFileStatusEnum("status").notNull().default("pending"),
    contentHash: text("content_hash"),
    stagingPrefix: text("staging_prefix").notNull(),
    errorMessage: text("error_message"),
    lastChunkAt: timestamp("last_chunk_at", { withTimezone: true, mode: "date" }),
    /** Browser File.lastModified — used when EXIF/SRT/container metadata is missing. */
    clientModifiedAt: timestamp("client_modified_at", {
      withTimezone: true,
      mode: "date",
    }),
    /** Folder-relative path from browser (e.g. 100_398/HYPERLAPSE_0001.JPG). */
    relativePath: text("relative_path"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("upload_files_batch_id_idx").on(table.batchId),
    index("upload_files_user_id_idx").on(table.userId),
    index("upload_files_status_idx").on(table.status),
    index("upload_files_expires_at_idx").on(table.expiresAt),
    index("upload_files_basename_idx").on(table.batchId, table.basename),
  ],
);

export const uploadBatchesRelations = relations(uploadBatches, ({ one, many }) => ({
  user: one(users, {
    fields: [uploadBatches.userId],
    references: [users.id],
  }),
  files: many(uploadFiles),
}));

export const uploadFilesRelations = relations(uploadFiles, ({ one }) => ({
  batch: one(uploadBatches, {
    fields: [uploadFiles.batchId],
    references: [uploadBatches.id],
  }),
  user: one(users, {
    fields: [uploadFiles.userId],
    references: [users.id],
  }),
  asset: one(assets, {
    fields: [uploadFiles.assetId],
    references: [assets.id],
  }),
}));
