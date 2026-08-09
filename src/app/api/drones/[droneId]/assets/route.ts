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
    const limit = limitRaw ? Number(limitRaw) : undefined;

    const assets = await listAssetsForDrone(session.user.id, droneId, {
      limit: Number.isFinite(limit) ? limit : undefined,
    });

    if (!assets) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ assets });
  } catch (error) {
    return jsonError(error);
  }
}
