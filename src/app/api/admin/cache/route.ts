import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getStorageSizeReport,
  purgeAssetCacheDerivatives,
} from "@/lib/admin/cache-hygiene";
import { purgeHlsPreviewHeight } from "@/lib/admin/hls-preview-cleanup";
import { jsonError, requireAdminSession } from "@/lib/api/auth";
import { HLS_PREVIEW_HEIGHTS } from "@/lib/playback/resolution";
import { cleanupOrphanUploads } from "@/lib/upload/orphan-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminSession();
    const report = await getStorageSizeReport();
    return NextResponse.json(report);
  } catch (error) {
    return jsonError(error);
  }
}

const purgeSchema = z.object({
  action: z.literal("purgeDerivatives").optional(),
  assetIds: z.array(z.string().uuid()).min(1).max(100),
  requeue: z.boolean().optional(),
});

const cleanStagingSchema = z.object({
  action: z.literal("cleanUploadStaging"),
});

const deleteHlsHeightSchema = z.object({
  action: z.literal("deleteHlsHeight"),
  height: z.number().int().refine(
    (value): value is (typeof HLS_PREVIEW_HEIGHTS)[number] =>
      (HLS_PREVIEW_HEIGHTS as readonly number[]).includes(value),
    { message: "height must be 720, 1080, or 1440" },
  ),
});

export async function POST(request: Request) {
  try {
    await requireAdminSession();
    const raw = await request.json();

    if (
      raw &&
      typeof raw === "object" &&
      (raw as { action?: string }).action === "cleanUploadStaging"
    ) {
      cleanStagingSchema.parse(raw);
      const result = await cleanupOrphanUploads();
      return NextResponse.json({
        ok: true,
        action: "cleanUploadStaging",
        ...result,
      });
    }

    if (
      raw &&
      typeof raw === "object" &&
      (raw as { action?: string }).action === "deleteHlsHeight"
    ) {
      const body = deleteHlsHeightSchema.parse(raw);
      const result = await purgeHlsPreviewHeight(body.height);
      return NextResponse.json({
        ok: true,
        action: "deleteHlsHeight",
        height: body.height,
        ...result,
      });
    }

    const body = purgeSchema.parse(raw);
    const result = await purgeAssetCacheDerivatives(body.assetIds, {
      requeue: body.requeue ?? true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
