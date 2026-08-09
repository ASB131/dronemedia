import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import {
  createMissionTemplate,
  listMissionTemplates,
} from "@/lib/missions/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checklistItemSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().trim().min(1).max(200),
  required: z.boolean().optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  checklist: z.array(checklistItemSchema).max(40).optional(),
  requireSrt: z.boolean().optional(),
  requireLrf: z.boolean().optional(),
  defaultDroneId: z.string().uuid().nullable().optional(),
  defaultAlbumId: z.string().uuid().nullable().optional(),
  defaultTags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export async function GET() {
  try {
    const session = await requireApprovedSession();
    const templates = await listMissionTemplates(session.user.id);
    return NextResponse.json({ templates });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApprovedSession();
    const body = createSchema.parse(await request.json());
    const template = await createMissionTemplate(session.user.id, body);
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
