import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getStorageSizeReport,
  purgeAssetCacheDerivatives,
} from "@/lib/admin/cache-hygiene";
import { jsonError, requireAdminSession } from "@/lib/api/auth";

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

const bodySchema = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(100),
  requeue: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    await requireAdminSession();
    const body = bodySchema.parse(await request.json());
    const result = await purgeAssetCacheDerivatives(body.assetIds, {
      requeue: body.requeue ?? true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
