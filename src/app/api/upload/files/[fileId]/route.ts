import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import {
  getUploadFileStatus,
  markUploadFileFailed,
} from "@/lib/upload/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchBodySchema = z.object({
  status: z.literal("failed"),
  errorMessage: z.string().max(2000).optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { fileId } = await context.params;
    const file = await getUploadFileStatus(fileId, session.user.id);
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const missingChunks = [];
    const uploaded = new Set(file.uploadedChunkIndices);
    for (let i = 0; i < file.totalChunks; i++) {
      if (!uploaded.has(i)) missingChunks.push(i);
    }

    return NextResponse.json({
      id: file.id,
      batchId: file.batchId,
      status: file.status,
      fileSizeBytes: file.fileSizeBytes,
      receivedBytes: file.receivedBytes,
      totalChunks: file.totalChunks,
      uploadedChunkIndices: file.uploadedChunkIndices,
      missingChunks,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { fileId } = await context.params;
    const body = patchBodySchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    const file = await markUploadFileFailed({
      fileId,
      userId: session.user.id,
      errorMessage: body.data.errorMessage,
    });
    return NextResponse.json({
      id: file.id,
      status: file.status,
      errorMessage: file.errorMessage,
    });
  } catch (error) {
    return jsonError(error);
  }
}
