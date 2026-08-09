import { NextResponse } from "next/server";
import { z } from "zod";

import {
  listBinAssets,
  purgeBinAssets,
  restoreBinAssets,
} from "@/lib/assets/bin";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bulkSchema = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(500),
});

export async function GET() {
  try {
    const session = await requireApprovedSession();
    const items = await listBinAssets(session.user.id);
    return NextResponse.json({ items });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApprovedSession();
    const body = bulkSchema.parse(await request.json());
    const result = await restoreBinAssets(session.user.id, body.assetIds);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireApprovedSession();
    const body = bulkSchema.parse(await request.json());
    const result = await purgeBinAssets(session.user.id, body.assetIds);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
