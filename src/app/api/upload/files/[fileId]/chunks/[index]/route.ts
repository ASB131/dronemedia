import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { getUploadFileStatus, recordUploadedChunk } from "@/lib/upload/session";
import { writeUploadChunk } from "@/lib/upload/chunks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  fileId: z.string().uuid(),
  index: z.coerce.number().int().min(0),
});

export async function PUT(
  request: Request,
  context: { params: Promise<{ fileId: string; index: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const rawParams = await context.params;
    const { fileId, index: chunkIndex } = paramsSchema.parse({
      fileId: rawParams.fileId,
      index: rawParams.index,
    });

    const file = await getUploadFileStatus(fileId, session.user.id);
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const buffer = Buffer.from(await request.arrayBuffer());
    if (buffer.length === 0) {
      return NextResponse.json({ error: "Empty chunk body" }, { status: 400 });
    }

    await writeUploadChunk({
      userId: session.user.id,
      fileId,
      chunkIndex,
      chunkSizeBytes: file.chunkSizeBytes,
      data: buffer,
    });

    const progress = await recordUploadedChunk({
      fileId,
      userId: session.user.id,
      chunkIndex,
      chunkBytes: buffer.length,
    });

    return NextResponse.json({
      fileId,
      chunkIndex,
      uploadedChunkIndices: progress.uploadedChunkIndices,
    });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return jsonError(error);
  }
}
