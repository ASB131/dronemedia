import { z } from "zod";

export const uploadInitFileSchema = z.object({
  filename: z.string().min(1).max(512),
  sizeBytes: z.coerce.number().int().positive(),
  /** File.lastModified from the browser (epoch ms). */
  lastModifiedMs: z.coerce.number().int().positive().optional(),
  /** Folder-relative path (webkitRelativePath / directory drop). */
  relativePath: z.string().min(1).max(2048).optional(),
});

/** Max files accepted in one upload batch init (media + sidecars). */
export const MAX_UPLOAD_BATCH_FILES = 500;

/** Soft byte cap per wave — waves end at whichever limit hits first (count or size). */
export const MAX_UPLOAD_BATCH_BYTES = 8 * 1024 * 1024 * 1024;

/** Human-readable GB for UI notices (matches MAX_UPLOAD_BATCH_BYTES). */
export const MAX_UPLOAD_BATCH_GB = 8;

export const uploadInitBodySchema = z.object({
  files: z.array(uploadInitFileSchema).min(1).max(MAX_UPLOAD_BATCH_FILES),
  batchId: z.string().uuid().optional(),
});

export const chunkIndexParamSchema = z.coerce.number().int().min(0);

export type UploadInitBody = z.infer<typeof uploadInitBodySchema>;
