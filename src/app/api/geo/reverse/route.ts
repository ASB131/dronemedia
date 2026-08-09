import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { reverseGeocode } from "@/lib/geo/reverse-geocode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export async function GET(request: Request) {
  try {
    await requireApprovedSession();
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.parse({
      lat: searchParams.get("lat"),
      lng: searchParams.get("lng"),
    });
    const result = await reverseGeocode(parsed.lat, parsed.lng);
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
