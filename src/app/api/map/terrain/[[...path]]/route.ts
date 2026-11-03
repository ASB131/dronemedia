import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { loadConfig } from "@/lib/config";
import {
  MAPTILER_TERRAIN_UPSTREAM,
  maptilerApiKey,
  proxiedTerrainBaseUrl,
} from "@/lib/map/maptiler-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rewriteTerrainJson(text: string, origin: string): string {
  const base = `${origin}${proxiedTerrainBaseUrl()}`;
  return text
    .replaceAll(`${MAPTILER_TERRAIN_UPSTREAM}/`, `${base}/`)
    .replaceAll(MAPTILER_TERRAIN_UPSTREAM, base)
    .replace(/\?key=[^"&\s\\]+/g, "");
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  try {
    await requireApprovedSession();
    const { path = [] } = await context.params;
    const config = loadConfig();
    const apiKey = maptilerApiKey(config);
    if (!apiKey) {
      return NextResponse.json({ error: "MapTiler not configured" }, { status: 503 });
    }

    const suffix = path.length > 0 ? `/${path.join("/")}` : "";
    const upstreamUrl = `${MAPTILER_TERRAIN_UPSTREAM}${suffix}?key=${encodeURIComponent(apiKey)}`;

    const upstreamRes = await fetch(upstreamUrl, {
      headers: { Accept: "*/*" },
      next: { revalidate: suffix ? 86400 : 3600 },
    });

    if (!upstreamRes.ok) {
      return new NextResponse(null, {
        status: upstreamRes.status === 429 ? 429 : 502,
      });
    }

    const contentType = upstreamRes.headers.get("content-type") ?? "";
    const origin = new URL(request.url).origin;

    if (contentType.includes("json") || suffix === "" || suffix.endsWith(".json")) {
      const text = await upstreamRes.text();
      const rewritten = rewriteTerrainJson(text, origin);
      return new NextResponse(rewritten, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    const bytes = await upstreamRes.arrayBuffer();
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": contentType || "application/octet-stream",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
