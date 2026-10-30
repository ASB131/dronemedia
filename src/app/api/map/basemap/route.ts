import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { loadConfig } from "@/lib/config";
import { resolveBasemapConfig } from "@/lib/map/basemap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireApprovedSession();
    const resolved = resolveBasemapConfig(loadConfig());
    return NextResponse.json({
      provider: resolved.provider,
      lightUrl: resolved.lightUrl,
      darkUrl: resolved.darkUrl,
      attribution: resolved.attribution,
      usingFallback: resolved.usingFallback,
      apiKeyConfigured: resolved.apiKeyConfigured,
    });
  } catch (error) {
    return jsonError(error);
  }
}
