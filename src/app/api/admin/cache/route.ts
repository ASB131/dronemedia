import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getStorageSizeReport,
  purgeAssetCacheDerivatives,
} from "@/lib/admin/cache-hygiene";
import { jsonError, requireAdminSession } from "@/lib/api/auth";
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

    const body = purgeSchema.parse(raw);
    const result = await purgeAssetCacheDerivatives(body.assetIds, {
      requeue: body.requeue ?? true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
