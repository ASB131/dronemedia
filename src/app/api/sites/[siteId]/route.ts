import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { deleteSiteNote, updateSiteNote } from "@/lib/sites/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ siteId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { siteId } = await context.params;
    const body = patchSchema.parse(await request.json());
    if (
      (body.lat !== undefined && body.lng === undefined) ||
      (body.lng !== undefined && body.lat === undefined)
    ) {
      return NextResponse.json(
        { error: "lat and lng must be provided together" },
        { status: 400 },
      );
    }
    const site = await updateSiteNote(session.user.id, siteId, body);
    if (!site) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ site });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ siteId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { siteId } = await context.params;
    const ok = await deleteSiteNote(session.user.id, siteId);
    if (!ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
