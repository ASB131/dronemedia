import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { getBatchStatus } from "@/lib/upload/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { batchId } = await context.params;
    const status = await getBatchStatus(batchId, session.user.id);
    if (!status) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }
    return NextResponse.json(status);
  } catch (error) {
    return jsonError(error);
  }
}
