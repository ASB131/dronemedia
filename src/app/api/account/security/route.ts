import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createApiKey,
  listApiKeysForUser,
  listDevicesForUser,
  revokeApiKey,
  revokeDevice,
} from "@/lib/auth/api-keys";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await requireApprovedSession();
    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") ?? "keys";

    if (view === "devices") {
      const devices = await listDevicesForUser(session.user.id);
      return NextResponse.json({
        devices: devices.map((device) => ({
          id: device.id,
          revoked: device.revoked,
          createdAt: device.createdAt.toISOString(),
          lastActiveAt: device.lastActiveAt.toISOString(),
          deviceInfo: device.deviceInfo ?? {},
        })),
      });
    }

    const keys = await listApiKeysForUser(session.user.id);
    return NextResponse.json({
      keys: keys.map((key) => ({
        id: key.id,
        label: key.label,
        createdAt: key.createdAt.toISOString(),
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

const createSchema = z.object({
  label: z.string().trim().min(1).max(64),
});

export async function POST(request: Request) {
  try {
    const session = await requireApprovedSession();
    const body = createSchema.parse(await request.json());
    const created = await createApiKey(session.user.id, body.label);
    return NextResponse.json(
      {
        key: {
          id: created.key.id,
          label: created.key.label,
          createdAt: created.key.createdAt.toISOString(),
        },
        raw: created.raw,
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}

const deleteSchema = z.object({
  type: z.enum(["key", "device"]),
  id: z.string().uuid(),
});

export async function DELETE(request: Request) {
  try {
    const session = await requireApprovedSession();
    const body = deleteSchema.parse(await request.json());
    const result =
      body.type === "key"
        ? await revokeApiKey(session.user.id, body.id)
        : await revokeDevice(session.user.id, body.id);
    if (!result) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
