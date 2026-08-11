import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { listAssetsForDrone } from "@/lib/drones/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ droneId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { droneId } = await context.params;
    const url = new URL(request.url);
    const limitRaw = url.searchParams.get("limit");
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const parsedLimit = limitRaw ? Number(limitRaw) : 48;
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 48;

    const result = await listAssetsForDrone(session.user.id, droneId, {
      limit,
      cursor,
    });

    if (!result) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      assets: result.assets,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    return jsonError(error);
  }
}
