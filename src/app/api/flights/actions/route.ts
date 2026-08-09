import { NextResponse } from "next/server";
import { z } from "zod";

import {
  mergeFlights,
  reassignAssetToFlight,
  splitAssetToNewFlight,
} from "@/lib/flights/queries";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("merge"),
    targetFlightId: z.string().uuid(),
    sourceFlightIds: z.array(z.string().uuid()).min(1).max(20),
  }),
  z.object({
    action: z.literal("split"),
    assetId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("reassign"),
    assetId: z.string().uuid(),
    flightId: z.string().uuid().nullable(),
  }),
]);

export async function POST(request: Request) {
  try {
    const session = await requireApprovedSession();
    const body = bodySchema.parse(await request.json());

    if (body.action === "merge") {
      const result = await mergeFlights(
        session.user.id,
        body.targetFlightId,
        body.sourceFlightIds,
      );
      if (!result) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json(result);
    }

    if (body.action === "split") {
      const result = await splitAssetToNewFlight(
        session.user.id,
        body.assetId,
      );
      if (!result) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json(result);
    }

    const result = await reassignAssetToFlight(
      session.user.id,
      body.assetId,
      body.flightId,
    );
    if (!result) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
