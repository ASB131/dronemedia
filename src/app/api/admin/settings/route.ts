import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, requireAdminSession } from "@/lib/api/auth";
import {
  getAdminSettingsView,
  patchAdminSettings,
  type AdminSettingsPatch,
} from "@/lib/admin/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  server: z
    .object({
      publicUrl: z.string().url().optional(),
    })
    .optional(),
  users: z
    .object({
      inviteOnly: z.boolean().optional(),
      defaultStorageQuotaBytes: z.number().int().positive().optional(),
    })
    .optional(),
  logging: z
    .object({
      level: z
        .enum(["trace", "debug", "info", "warn", "error", "fatal"])
        .optional(),
    })
    .optional(),
  upload: z
    .object({
      maxFileSizeBytes: z.number().int().positive().optional(),
      chunkSizeBytes: z.number().int().positive().optional(),
      incompleteUploadTtlHours: z.number().int().positive().optional(),
    })
    .optional(),
  deduplication: z
    .object({
      algorithm: z.enum(["xxhash", "sha256"]).optional(),
      onDuplicate: z.enum(["reject", "flag"]).optional(),
    })
    .optional(),
  bin: z
    .object({
      purgeAfterDays: z.number().int().positive().optional(),
    })
    .optional(),
  images: z
    .object({
      thumbnailMaxEdge: z.number().int().positive().optional(),
      thumbnailQuality: z.number().int().min(40).max(95).optional(),
      webMaxEdge: z.number().int().positive().optional(),
      webQuality: z.number().int().min(40).max(95).optional(),
    })
    .optional(),
  nightly: z
    .object({
      binCleanupCron: z.string().optional(),
      orphanUploadCleanupCron: z.string().optional(),
      integrityCheckCron: z.string().optional(),
    })
    .optional(),
  jobs: z
    .object({
      concurrency: z.record(z.string(), z.number().int().positive()).optional(),
      gates: z
        .object({
          webTranscoding: z.boolean().optional(),
          panoramaStitch: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
  theme: z
    .object({
      default: z.enum(["light", "dark", "system"]).optional(),
      accent: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .optional(),
    })
    .optional(),
  backup: z
    .object({
      enabled: z.boolean().optional(),
      cron: z.string().optional(),
      retainDays: z.number().int().positive().optional(),
    })
    .optional(),
  transcoding: z
    .object({
      hwAccel: z.enum(["none", "qsv", "nvenc", "vaapi"]).optional(),
      proxy: z
        .object({
          maxHeight: z.number().int().positive().optional(),
          videoCodec: z.string().optional(),
          audioCodec: z.string().optional(),
        })
        .optional(),
      hls: z
        .object({
          segmentDurationSeconds: z.number().int().positive().optional(),
          playlistType: z.enum(["vod", "event"]).optional(),
          heights: z.array(z.number().int().positive()).min(1).optional(),
        })
        .optional(),
      sequences: z
        .object({
          fps: z.number().positive().optional(),
          fullResCrf: z.number().int().min(1).max(51).optional(),
          fullResPreset: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  notifications: z
    .object({
      sse: z
        .object({
          enabled: z.boolean().optional(),
          heartbeatIntervalSeconds: z.number().int().positive().optional(),
        })
        .optional(),
      polling: z
        .object({
          enabled: z.boolean().optional(),
          fallbackIntervalSeconds: z.number().int().positive().optional(),
        })
        .optional(),
    })
    .optional(),
  versionCheck: z
    .object({
      enabled: z.boolean().optional(),
    })
    .optional(),
  playback: z
    .object({
      allowInAppSource: z.boolean().optional(),
    })
    .optional(),
  auth: z
    .object({
      login: z
        .object({
          maxAttempts: z.number().int().positive().optional(),
          lockoutBaseSeconds: z.number().int().positive().optional(),
        })
        .optional(),
    })
    .optional(),
});

export async function GET() {
  try {
    await requireAdminSession();
    return NextResponse.json({ settings: getAdminSettingsView() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdminSession();
    const body = patchSchema.parse(await request.json()) as AdminSettingsPatch;
    patchAdminSettings(body);
    return NextResponse.json({ settings: getAdminSettingsView() });
  } catch (error) {
    return jsonError(error);
  }
}
