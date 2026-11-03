import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { loadConfig } from "@/lib/config";
import {
  mapStyleById,
  normalizeMapStyleId,
} from "@/lib/map/map-styles";
import {
  maptilerApiKey,
  upstreamMaptilerTileUrl,
} from "@/lib/map/maptiler-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  styleId: string;
  z: string;
  x: string;
  y: string;
};

function parseTileCoord(raw: string): number | null {
  const base = raw.includes(".") ? raw.split(".")[0]! : raw;
  const value = Number(base);
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

export async function GET(
  _request: Request,
  context: { params: Promise<Params> },
) {
  try {
    await requireApprovedSession();
    const { styleId: rawStyle, z: zRaw, x: xRaw, y: yRaw } =
      await context.params;

    const styleId = normalizeMapStyleId(rawStyle);
    const style = mapStyleById(styleId);
    if (!style.maptilerId) {
      return NextResponse.json({ error: "Not a MapTiler style" }, { status: 400 });
    }

    const z = parseTileCoord(zRaw);
    const x = parseTileCoord(xRaw);
    const y = parseTileCoord(yRaw);
    if (z == null || x == null || y == null || z > 22) {
      return NextResponse.json({ error: "Invalid tile coordinates" }, { status: 400 });
    }

    const config = loadConfig();
    const apiKey = maptilerApiKey(config);
    if (!apiKey) {
      return NextResponse.json({ error: "MapTiler not configured" }, { status: 503 });
    }

    const upstream = upstreamMaptilerTileUrl(style, z, x, y, apiKey);
    const upstreamRes = await fetch(upstream, {
      headers: { Accept: "image/*" },
      next: { revalidate: 86400 },
    });

    if (!upstreamRes.ok) {
      return new NextResponse(null, {
        status: upstreamRes.status === 429 ? 429 : 502,
      });
    }

    const bytes = await upstreamRes.arrayBuffer();
    const contentType =
      upstreamRes.headers.get("content-type") ??
      (style.tileFormat === "jpg" ? "image/jpeg" : "image/png");

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
