import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import {
  LUT_COLOR_PROFILES,
  type LutColorProfile,
} from "@/lib/luts/color-profile";
import { listLuts } from "@/lib/luts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Metadata-only list for approved users (asset LUT picker). */
export async function GET(request: Request) {
  try {
    await requireApprovedSession();
    const { searchParams } = new URL(request.url);
    const raw = searchParams.get("colorProfile");
    const colorProfile =
      raw && (LUT_COLOR_PROFILES as string[]).includes(raw)
        ? (raw as LutColorProfile)
        : null;
    const items = await listLuts(
      colorProfile ? { colorProfile } : undefined,
    );
    return NextResponse.json({
      luts: items.map((lut) => ({
        id: lut.id,
        name: lut.name,
        colorProfile: lut.colorProfile,
        sizeBytes: lut.sizeBytes,
        createdAt: lut.createdAt,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
