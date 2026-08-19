import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import {
  listCinemaPlaylist,
  type CinemaSource,
} from "@/lib/cinema/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseSource(value: string | null): CinemaSource {
  if (value === "favorites" || value === "albums") return value;
  return "all";
}

export async function GET(request: Request) {
  try {
    const session = await requireApprovedSession();
    const { searchParams } = new URL(request.url);
    const source = parseSource(searchParams.get("source"));
    const albumIds = (searchParams.get("albumIds") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    const items = await listCinemaPlaylist(session.user.id, {
      source,
      albumIds,
    });

    return NextResponse.json({ items, count: items.length });
  } catch (error) {
    return jsonError(error);
  }
}
