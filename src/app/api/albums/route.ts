import { NextResponse } from "next/server";
import { z } from "zod";

import { createAlbum, listAlbumsForUser } from "@/lib/albums/queries";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});

export async function GET() {
  try {
    const session = await requireApprovedSession();
    const albums = await listAlbumsForUser(session.user.id);
    return NextResponse.json({ albums });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApprovedSession();
    const body = createSchema.parse(await request.json());
    const album = await createAlbum(session.user.id, body);
    return NextResponse.json({ album }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
