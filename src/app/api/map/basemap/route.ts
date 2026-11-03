import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { loadConfig } from "@/lib/config";
import { resolveBasemapForStyle } from "@/lib/map/map-styles";
import { getUserMapStyleId } from "@/lib/map/user-map-style";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireApprovedSession();
    const styleId = await getUserMapStyleId(session.user.id);
    const resolved = resolveBasemapForStyle(loadConfig(), styleId);
    return NextResponse.json({
      provider: resolved.provider,
      lightUrl: resolved.lightUrl,
      darkUrl: resolved.darkUrl,
      attribution: resolved.attribution,
      usingFallback: resolved.usingFallback,
      apiKeyConfigured: resolved.apiKeyConfigured,
      styleId: resolved.styleId,
      maxZoom: resolved.maxZoom,
    });
  } catch (error) {
    return jsonError(error);
  }
}
