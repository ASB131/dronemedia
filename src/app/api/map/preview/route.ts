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

const UPSTREAM_HEADERS = {
  Accept: "image/*,*/*",
  "User-Agent": "DroneMedia/1.0 (map-style-preview)",
};

export async function GET(request: Request) {
  try {
    await requireApprovedSession();
    const url = new URL(request.url);
    const styleId = normalizeMapStyleId(url.searchParams.get("styleId"));
    const style = mapStyleById(styleId);

    if (!style.maptilerId) {
      const osm = await fetch("https://tile.openstreetmap.org/5/15/10.png", {
        headers: UPSTREAM_HEADERS,
      });
      if (!osm.ok) {
        return new NextResponse(null, { status: 502 });
      }
      const bytes = await osm.arrayBuffer();
      return new NextResponse(bytes, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=604800",
        },
      });
    }

    const config = loadConfig();
    const apiKey = maptilerApiKey(config);
    if (!apiKey) {
      return NextResponse.json({ error: "MapTiler not configured" }, { status: 503 });
    }

    const { lng, lat } = style.previewCenter;
    const previewZoom = Math.min(style.previewCenter.zoom, 10);
    const { x, y, z } = lonLatToTileXY(lng, lat, previewZoom);
    const upstream = upstreamMaptilerTileUrl(style, z, x, y, apiKey);
    const upstreamRes = await fetch(upstream, {
      headers: UPSTREAM_HEADERS,
      cache: "force-cache",
    });

    if (!upstreamRes.ok) {
      return new NextResponse(null, { status: upstreamRes.status });
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
