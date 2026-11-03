import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { loadConfig } from "@/lib/config";
import {
  MAP_STYLE_CATALOG,
  mapStylePreviewUrl,
  normalizeMapStyleId,
} from "@/lib/map/map-styles";
import { getUserMapStyleId } from "@/lib/map/user-map-style";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireApprovedSession();
    const config = loadConfig();
    const selectedStyleId = await getUserMapStyleId(session.user.id);
    const provider = config.map?.provider ?? "carto";
    const hasMaptilerKey = Boolean(
      (config.map?.apiKey?.trim() || process.env.MAP_API_KEY?.trim()) &&
        provider === "maptiler",
    );

    const styles = MAP_STYLE_CATALOG.filter((style) => {
      if (style.id === "osm") return true;
      return hasMaptilerKey && style.maptilerId;
    }).map((style) => ({
      id: style.id,
      label: style.label,
      description: style.description,
      previewUrl: mapStylePreviewUrl(config, style.id),
    }));

    return NextResponse.json({
      selectedStyleId: normalizeMapStyleId(selectedStyleId),
      styles,
      maptilerConfigured: hasMaptilerKey,
    });
  } catch (error) {
    return jsonError(error);
  }
}
