import { NextResponse } from "next/server";

import { jsonError, requireApprovedSessionOrApiKey } from "@/lib/api/auth";
import { assembleUploadFile } from "@/lib/upload/assemble";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  try {
    const session = await requireApprovedSessionOrApiKey(request);
    const { fileId } = await context.params;
    const file = await assembleUploadFile(fileId, session.user.id);
    return NextResponse.json({
      id: file.id,
      status: file.status,
      contentHash: file.contentHash,
    });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return jsonError(error);
  }
}
