import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import {
  deleteMissionTemplate,
  updateMissionTemplate,
} from "@/lib/missions/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checklistItemSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().trim().min(1).max(200),
  required: z.boolean().optional(),
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  checklist: z.array(checklistItemSchema).max(40).optional(),
  requireSrt: z.boolean().optional(),
  requireLrf: z.boolean().optional(),
  defaultDroneId: z.string().uuid().nullable().optional(),
  defaultAlbumId: z.string().uuid().nullable().optional(),
  defaultTags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ templateId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { templateId } = await context.params;
    const body = patchSchema.parse(await request.json());
    const template = await updateMissionTemplate(
      session.user.id,
      templateId,
      body,
    );
    if (!template) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ template });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ templateId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { templateId } = await context.params;
    const ok = await deleteMissionTemplate(session.user.id, templateId);
    if (!ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
