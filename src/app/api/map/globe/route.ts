import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { loadConfig } from "@/lib/config";
import { resolveGlobeConfig } from "@/lib/map/globe-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireApprovedSession();
    const resolved = resolveGlobeConfig(loadConfig());
    return NextResponse.json({
      terrainMode: resolved.terrainMode,
      cesiumIonAccessToken: resolved.cesiumIonAccessToken,
      mapTilerTerrainUrl: resolved.mapTilerTerrainUrl,
      imageryUrlTemplate: resolved.imageryUrlTemplate,
      attribution: resolved.attribution,
      usingFallbackTerrain: resolved.usingFallbackTerrain,
    });
  } catch (error) {
    return jsonError(error);
  }
}
