import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { findUserById } from "@/lib/auth/users";
import { loadConfig } from "@/lib/config";
import { getWebDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  coercePlaybackResolution,
  normalizeHlsPreviewHeights,
} from "@/lib/playback/resolution";
import { resolveAllowInAppSource } from "@/lib/playback/source-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  downloadOriginalDefault: z.boolean().optional(),
  zipMultiSelectDefault: z.boolean().optional(),
  notificationsEnabled: z.boolean().optional(),
  defaultPlaybackResolution: z
    .enum(["720", "1080", "1440", "source"])
    .optional(),
  previewLutId: z.string().uuid().nullable().optional(),
  defaultDLogLutId: z.string().uuid().nullable().optional(),
  defaultDLogMLutId: z.string().uuid().nullable().optional(),
  cinematicSource: z.enum(["all", "favorites", "albums"]).optional(),
  cinematicAlbumIds: z.array(z.string().uuid()).max(50).optional(),
  cinematicLutId: z.string().uuid().nullable().optional(),
});

export async function PATCH(request: Request) {
  try {
    const session = await requireApprovedSession();
    const body = bodySchema.parse(await request.json());
    const db = getWebDb();
    const config = loadConfig();
    const user = await findUserById(session.user.id);
    if (!user) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const enabledHeights = normalizeHlsPreviewHeights(
      config.transcoding.hls.heights,
    );
    const allowInAppSource = resolveAllowInAppSource({
      role: user.role,
      userPreference: user.preferences?.allowInAppSource ?? null,
      globalAllow: config.playback?.allowInAppSource ?? true,
    });

    let nextResolution = body.defaultPlaybackResolution;
    if (nextResolution !== undefined) {
      if (nextResolution === "source" && !allowInAppSource) {
        return NextResponse.json(
          { error: "Source playback is disabled" },
          { status: 400 },
        );
      }
      if (
        nextResolution !== "source" &&
        !enabledHeights.includes(
          Number(nextResolution) as (typeof enabledHeights)[number],
        )
      ) {
        return NextResponse.json(
          { error: "That preview quality is disabled by an administrator" },
          { status: 400 },
        );
      }
      nextResolution = coercePlaybackResolution(
        nextResolution,
        enabledHeights,
        allowInAppSource,
      );
    }

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
      ...(nextResolution !== undefined
        ? { defaultPlaybackResolution: nextResolution }
        : {}),
      ...(body.previewLutId !== undefined
        ? { previewLutId: body.previewLutId }
        : {}),
      ...(body.defaultDLogLutId !== undefined
        ? { defaultDLogLutId: body.defaultDLogLutId }
        : {}),
      ...(body.defaultDLogMLutId !== undefined
        ? { defaultDLogMLutId: body.defaultDLogMLutId }
        : {}),
      ...(body.cinematicSource !== undefined
        ? { cinematicSource: body.cinematicSource }
        : {}),
      ...(body.cinematicAlbumIds !== undefined
        ? { cinematicAlbumIds: body.cinematicAlbumIds }
        : {}),
      ...(body.cinematicLutId !== undefined
        ? { cinematicLutId: body.cinematicLutId }
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
