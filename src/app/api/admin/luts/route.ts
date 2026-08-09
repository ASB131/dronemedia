import { NextResponse } from "next/server";

import { ApiError, jsonError, requireAdminSession } from "@/lib/api/auth";
import { getWebDb } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { createLutFromUpload, listLuts } from "@/lib/luts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminSession();
    const items = await listLuts();
    return NextResponse.json({ luts: items });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAdminSession();
    const form = await request.formData();
    const file = form.get("file");
    const nameField = form.get("name");
    const colorProfileField = form.get("colorProfile");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (typeof colorProfileField !== "string") {
      return NextResponse.json(
        { error: "colorProfile is required (d_log or d_logm)" },
        { status: 400 },
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const lut = await createLutFromUpload({
      fileName: file.name,
      bytes,
      createdBy: session.user.id,
      displayName: typeof nameField === "string" ? nameField : null,
      colorProfile: colorProfileField,
    });

    const db = getWebDb();
    await db.insert(auditLogs).values({
      actorUserId: session.user.id,
      actionType: "lut.create",
      targetType: "lut",
      targetId: lut.id,
      metadata: {
        name: lut.name,
        sizeBytes: lut.sizeBytes,
        colorProfile: lut.colorProfile,
      },
    });

    return NextResponse.json({ lut }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return jsonError(error);
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return jsonError(error);
  }
}
