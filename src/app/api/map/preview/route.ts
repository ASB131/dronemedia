import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { loadConfig } from "@/lib/config";
import {
  mapStyleById,
  normalizeMapStyleId,
} from "@/lib/map/map-styles";
import {
  lonLatToTileXY,
  maptilerApiKey,
  upstreamMaptilerTileUrl,
} from "@/lib/map/maptiler-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireApprovedSession();
    const url = new URL(request.url);
    const styleId = normalizeMapStyleId(url.searchParams.get("styleId"));
    const style = mapStyleById(styleId);

    if (!style.maptilerId) {
      return NextResponse.redirect("https://tile.openstreetmap.org/5/15/10.png", 302);
    }

    const config = loadConfig();
    const apiKey = maptilerApiKey(config);
    if (!apiKey) {
      return NextResponse.json({ error: "MapTiler not configured" }, { status: 503 });
    }

    const { lng, lat, zoom } = style.previewCenter;
    const { x, y, z } = lonLatToTileXY(lng, lat, zoom);
    const upstream = upstreamMaptilerTileUrl(style, z, x, y, apiKey);
    const upstreamRes = await fetch(upstream, { next: { revalidate: 604800 } });

    if (!upstreamRes.ok) {
      return new NextResponse(null, { status: 502 });
    }

    const bytes = await upstreamRes.arrayBuffer();
    const contentType =
      upstreamRes.headers.get("content-type") ??
      (style.tileFormat === "jpg" ? "image/jpeg" : "image/png");

    return new NextResponse(bytes, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=604800",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
