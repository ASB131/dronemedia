import { NextResponse } from "next/server";
import { z } from "zod";

import {
  deleteAlbum,
  getAlbumForUser,
  updateAlbum,
} from "@/lib/albums/queries";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ albumId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { albumId } = await context.params;
    const url = new URL(request.url);
    const limitRaw = url.searchParams.get("limit");
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const parsedLimit = limitRaw ? Number(limitRaw) : 48;
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 48;

    const album = await getAlbumForUser(session.user.id, albumId, {
      limit,
      cursor,
    });

    if (!album) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ album, nextCursor: album.nextCursor });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ albumId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { albumId } = await context.params;
    const body = updateSchema.parse(await request.json());
    const album = await updateAlbum(session.user.id, albumId, body);

    if (!album) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ album });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ albumId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { albumId } = await context.params;
    const deleted = await deleteAlbum(session.user.id, albumId);

    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
