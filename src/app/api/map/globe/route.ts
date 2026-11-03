import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { loadConfig } from "@/lib/config";
import { resolveGlobeConfig } from "@/lib/map/globe-config";
import { getUserMapStyleId } from "@/lib/map/user-map-style";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireApprovedSession();
    const styleId = await getUserMapStyleId(session.user.id);
    const resolved = resolveGlobeConfig(loadConfig(), styleId);
    return NextResponse.json({
      terrainMode: resolved.terrainMode,
      cesiumIonAccessToken: resolved.cesiumIonAccessToken,
      mapTilerTerrainUrl: resolved.mapTilerTerrainUrl,
      imageryUrlTemplate: resolved.imageryUrlTemplate,
      imageryMaxZoom: resolved.imageryMaxZoom,
      attribution: resolved.attribution,
      usingFallbackTerrain: resolved.usingFallbackTerrain,
      mapStyleId: resolved.mapStyleId,
    });
  } catch (error) {
    return jsonError(error);
  }
}
