import { pgEnum } from "drizzle-orm/pg-core";

export const uploadBatchStatusEnum = pgEnum("upload_batch_status", [
  "open",
  "committing",
  "committed",
  "cancelled",
]);

export const uploadFileStatusEnum = pgEnum("upload_file_status", [
  "pending",
  "uploading",
  "assembling",
  "complete",
  "failed",
  "cancelled",
]);
