import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { getWebDb } from "@/lib/db";
import { users } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  downloadOriginalDefault: z.boolean().optional(),
  zipMultiSelectDefault: z.boolean().optional(),
  notificationsEnabled: z.boolean().optional(),
  defaultPlaybackResolution: z
    .enum(["1080", "1440", "source"])
    .optional(),
  previewLutId: z.string().uuid().nullable().optional(),
});

export async function PATCH(request: Request) {
  try {
    const session = await requireApprovedSession();
    const body = bodySchema.parse(await request.json());
    const db = getWebDb();

    const [row] = await db
      .select({ preferences: users.preferences })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const preferences = {
      ...row.preferences,
      ...(body.theme !== undefined ? { theme: body.theme } : {}),
      ...(body.downloadOriginalDefault !== undefined
        ? { downloadOriginalDefault: body.downloadOriginalDefault }
        : {}),
      ...(body.zipMultiSelectDefault !== undefined
        ? { zipMultiSelectDefault: body.zipMultiSelectDefault }
        : {}),
      ...(body.notificationsEnabled !== undefined
        ? { notificationsEnabled: body.notificationsEnabled }
        : {}),
      ...(body.defaultPlaybackResolution !== undefined
        ? { defaultPlaybackResolution: body.defaultPlaybackResolution }
        : {}),
      ...(body.previewLutId !== undefined
        ? { previewLutId: body.previewLutId }
        : {}),
    };

    await db
      .update(users)
      .set({ preferences, updatedAt: new Date() })
      .where(eq(users.id, session.user.id));

    return NextResponse.json({ preferences });
  } catch (error) {
    return jsonError(error);
  }
}
