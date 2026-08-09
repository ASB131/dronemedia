import { NextResponse } from "next/server";

import {
  ApiError,
  jsonError,
  requireApprovedSession,
} from "@/lib/api/auth";
import { formatDbError } from "@/lib/api/db-error";
import { createUploadBatch } from "@/lib/upload/session";
import { uploadInitBodySchema } from "@/lib/upload/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await requireApprovedSession();
    const body = uploadInitBodySchema.parse(await request.json());
    const result = await createUploadBatch(session.user.id, body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonError(error);
    }
    return NextResponse.json({ error: formatDbError(error) }, { status: 400 });
  }
}
