import { NextResponse } from "next/server";
import { z } from "zod";

import {
  decodeTimelineCursor,
  getTimelineForUser,
} from "@/lib/assets/timeline";
import { ApiError, jsonError, requireApprovedSession } from "@/lib/api/auth";
import { requireTripDates } from "@/lib/trips/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  type: z.enum(["all", "photo", "video", "panorama"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { tripId } = await context.params;
    const { startDate, endDate } = await requireTripDates(
      session.user.id,
      tripId,
    );
    const { searchParams } = new URL(request.url);
    const query = querySchema.parse({
      type: searchParams.get("type") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      cursor: searchParams.get("cursor") ?? undefined,
    });
    let cursor;
    try {
      cursor = query.cursor ? decodeTimelineCursor(query.cursor) : undefined;
    } catch {
      throw new ApiError(400, "Invalid timeline cursor");
    }
    const timeline = await getTimelineForUser(session.user.id, {
      mediaType: query.type ?? "all",
      limit: query.limit,
      cursor,
      captureDateFrom: startDate,
      captureDateTo: endDate,
    });
    return NextResponse.json(timeline);
  } catch (error) {
    return jsonError(error);
  }
}