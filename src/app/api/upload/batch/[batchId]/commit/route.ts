import { NextResponse } from "next/server";

import {
  ApiError,
  jsonError,
  requireApprovedSessionOrApiKey,
} from "@/lib/api/auth";
import { formatDbError } from "@/lib/api/db-error";
import { commitUploadBatch } from "@/lib/upload/commit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  try {
    const session = await requireApprovedSessionOrApiKey(request);
    const { batchId } = await context.params;
    const result = await commitUploadBatch(batchId, session.user.id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonError(error);
    }
    return NextResponse.json({ error: formatDbError(error) }, { status: 400 });
  }
}
