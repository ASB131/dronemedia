import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import {
  createSiteNote,
  listSiteNotes,
} from "@/lib/sites/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  note: z.string().trim().max(2000).nullable().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export async function GET() {
  try {
    const session = await requireApprovedSession();
    const sites = await listSiteNotes(session.user.id);
    return NextResponse.json({ sites });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApprovedSession();
    const body = createSchema.parse(await request.json());
    const site = await createSiteNote(session.user.id, body);
    return NextResponse.json({ site }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
