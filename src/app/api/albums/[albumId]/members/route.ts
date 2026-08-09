import { NextResponse } from "next/server";
import { z } from "zod";

import {
  addAlbumMember,
  listAlbumMembers,
  removeAlbumMember,
  updateAlbumMemberRole,
} from "@/lib/albums/queries";
import { getAlbumAccess } from "@/lib/albums/access";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const addSchema = z.object({
  username: z.string().trim().min(1).max(64),
  role: z.enum(["editor", "viewer"]).default("viewer"),
});

const patchSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["editor", "viewer"]),
});

const deleteSchema = z.object({
  userId: z.string().uuid(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ albumId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { albumId } = await context.params;
    const access = await getAlbumAccess(session.user.id, albumId);
    if (!access) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const members = await listAlbumMembers(albumId);
    return NextResponse.json({ members });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ albumId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { albumId } = await context.params;
    const body = addSchema.parse(await request.json());
    const member = await addAlbumMember(
      session.user.id,
      albumId,
      body.username,
      body.role,
    );

    if (!member) {
      return NextResponse.json(
        { error: "Unable to add member (not found or not allowed)" },
        { status: 400 },
      );
    }

    return NextResponse.json({ member }, { status: 201 });
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
    const body = patchSchema.parse(await request.json());
    const row = await updateAlbumMemberRole(
      session.user.id,
      albumId,
      body.userId,
      body.role,
    );

    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ albumId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { albumId } = await context.params;
    const body = deleteSchema.parse(await request.json());
    const row = await removeAlbumMember(
      session.user.id,
      albumId,
      body.userId,
    );

    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
