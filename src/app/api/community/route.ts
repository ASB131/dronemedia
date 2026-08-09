import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import {
  listCommunityMapAssets,
  listCommunityProfiles,
} from "@/lib/profiles/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireApprovedSession();
    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") ?? "profiles";

    if (view === "map") {
      const mapAssets = await listCommunityMapAssets();
      return NextResponse.json({ mapAssets });
    }

    const users = await listCommunityProfiles();
    return NextResponse.json({ users });
  } catch (error) {
    return jsonError(error);
  }
}
