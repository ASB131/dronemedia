import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { listMapAssetsForUser } from "@/lib/map/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseNum(value: string | null): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export async function GET(request: Request) {
  try {
    const session = await requireApprovedSession();
    const { searchParams } = new URL(request.url);
    const typeParam = searchParams.get("type");
    const assetType =
      typeParam === "photo" || typeParam === "video" ? typeParam : undefined;

    const assets = await listMapAssetsForUser(session.user.id, {
      assetType,
      north:
        searchParams.get("heatmap") === "1"
          ? undefined
          : parseNum(searchParams.get("north")),
      south:
        searchParams.get("heatmap") === "1"
          ? undefined
          : parseNum(searchParams.get("south")),
      east:
        searchParams.get("heatmap") === "1"
          ? undefined
          : parseNum(searchParams.get("east")),
      west:
        searchParams.get("heatmap") === "1"
          ? undefined
          : parseNum(searchParams.get("west")),
      limit: parseNum(searchParams.get("limit")),
    });
    return NextResponse.json({ assets, count: assets.length });
  } catch (error) {
    return jsonError(error);
  }
}
