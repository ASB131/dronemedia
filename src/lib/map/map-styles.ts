import type { AppConfig } from "@/lib/config/schema";

import {
  type BasemapResolved,
  readMapApiKey,
  osmBasemap,
} from "@/lib/map/basemap";

export type MapStyleDefinition = {
  id: string;
  label: string;
  description: string;
  /** MapTiler map id; omitted for built-in OSM/Carto fallbacks. */
  maptilerId?: string;
  tileFormat: "png" | "jpg";
  /** Static preview center for thumbnail generation. */
  previewCenter: { lng: number; lat: number; zoom: number };
};

export const DEFAULT_MAP_STYLE_ID = "hybrid";

export const MAP_STYLE_CATALOG: MapStyleDefinition[] = [
  {
    id: "hybrid",
    label: "Hybrid",
    description: "Satellite imagery with roads and labels",
    maptilerId: "hybrid",
    tileFormat: "jpg",
    previewCenter: { lng: -1.75, lat: 53.8, zoom: 12 },
  },
  {
    id: "satellite",
    label: "Satellite",
    description: "High-resolution satellite only",
    maptilerId: "satellite",
    tileFormat: "jpg",
    previewCenter: { lng: -1.75, lat: 53.8, zoom: 12 },
  },
  {
    id: "streets",
    label: "Streets",
    description: "Clean street map with labels",
    maptilerId: "streets-v2",
    tileFormat: "png",
    previewCenter: { lng: -1.75, lat: 53.8, zoom: 12 },
  },
  {
    id: "outdoor",
    label: "Outdoor",
    description: "Topographic detail for hiking and terrain",
    maptilerId: "outdoor-v2",
    tileFormat: "png",
    previewCenter: { lng: -1.75, lat: 53.8, zoom: 11 },
  },
  {
    id: "bright",
    label: "Bright",
    description: "Light neutral basemap",
    maptilerId: "bright-v2",
    tileFormat: "png",
    previewCenter: { lng: -1.75, lat: 53.8, zoom: 11 },
  },
  {
    id: "dark",
    label: "Dark",
    description: "Dark basemap for night viewing",
    maptilerId: "dataviz-dark",
    tileFormat: "png",
    previewCenter: { lng: -1.75, lat: 53.8, zoom: 11 },
  },
  {
    id: "topo",
    label: "Topographic",
    description: "Contours and elevation shading",
    maptilerId: "topo-v2",
    tileFormat: "png",
    previewCenter: { lng: -1.75, lat: 53.8, zoom: 10 },
  },
  {
    id: "winter",
    label: "Winter",
    description: "Cool palette with terrain relief",
    maptilerId: "winter-v2",
    tileFormat: "png",
    previewCenter: { lng: -1.75, lat: 53.8, zoom: 10 },
  },
  {
    id: "osm",
    label: "OpenStreetMap",
    description: "Standard OSM tiles (no API key)",
    tileFormat: "png",
    previewCenter: { lng: -1.75, lat: 53.8, zoom: 11 },
  },
];

const MAPTILER_ATTRIBUTION =
  '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export function normalizeMapStyleId(styleId: string | null | undefined): string {
  const id = styleId?.trim();
  if (id && MAP_STYLE_CATALOG.some((entry) => entry.id === id)) {
    return id;
  }
  return DEFAULT_MAP_STYLE_ID;
}

export function mapStyleById(styleId: string): MapStyleDefinition {
  return (
    MAP_STYLE_CATALOG.find((entry) => entry.id === styleId) ??
    MAP_STYLE_CATALOG.find((entry) => entry.id === DEFAULT_MAP_STYLE_ID)!
  );
}

function maptilerTileUrl(
  mapId: string,
  format: "png" | "jpg",
  apiKey: string,
): string {
  const key = encodeURIComponent(apiKey);
  return `https://api.maptiler.com/maps/${mapId}/{z}/{x}/{y}.${format}?key=${key}`;
}

export function mapStylePreviewUrl(
  _config: AppConfig,
  styleId: string,
  _size = "240x140",
): string | null {
  const style = mapStyleById(normalizeMapStyleId(styleId));
  if (style.id === "osm") {
    return null;
  }
  if (style.maptilerId) {
    return `/api/map/preview?styleId=${encodeURIComponent(style.id)}`;
  }
  return null;
}

/** Resolve 2D Leaflet tile URLs for a user-selected style. */
export function resolveBasemapForStyle(
  config: AppConfig,
  styleIdInput: string | null | undefined,
): BasemapResolved & { styleId: string; maxZoom: number } {
  const styleId = normalizeMapStyleId(styleIdInput);
  const style = mapStyleById(styleId);
  const provider = config.map?.provider ?? "carto";
  const apiKey = readMapApiKey(config);

  if (style.id === "osm" || provider === "osm") {
    if (style.id === "osm") {
      return { ...osmBasemap(), styleId: "osm", maxZoom: 19 };
    }
  }

  if (style.maptilerId && apiKey) {
    const url = maptilerTileUrl(style.maptilerId, style.tileFormat, apiKey);
    return {
      provider: "maptiler",
      lightUrl: url,
      darkUrl: url,
      attribution: MAPTILER_ATTRIBUTION,
      usingFallback: false,
      apiKeyConfigured: true,
      styleId,
      maxZoom: 22,
    };
  }

  if (provider === "maptiler" && apiKey) {
    const fallback = mapStyleById(DEFAULT_MAP_STYLE_ID);
    const url = maptilerTileUrl(
      fallback.maptilerId!,
      fallback.tileFormat,
      apiKey,
    );
    return {
      provider: "maptiler",
      lightUrl: url,
      darkUrl: url,
      attribution: MAPTILER_ATTRIBUTION,
      usingFallback: true,
      apiKeyConfigured: true,
      styleId: DEFAULT_MAP_STYLE_ID,
      maxZoom: 22,
    };
  }

  const osm = osmBasemap();
  return {
    ...osm,
    usingFallback: true,
    styleId: "osm",
    maxZoom: 19,
  };
}

export function resolveImageryTemplateForStyle(
  config: AppConfig,
  styleIdInput: string | null | undefined,
): {
  imageryUrlTemplate: string;
  attribution: string;
  maxZoom: number;
  styleId: string;
} {
  const resolved = resolveBasemapForStyle(config, styleIdInput);
  return {
    imageryUrlTemplate: resolved.lightUrl,
    attribution: resolved.attribution,
    maxZoom: resolved.maxZoom,
    styleId: resolved.styleId,
  };
}

/** Cesium loads tiles via XHR — use same-origin proxy (see /api/map/tiles). */
export function resolveGlobeImageryForStyle(
  config: AppConfig,
  styleIdInput: string | null | undefined,
): {
  imageryUrlTemplate: string;
  attribution: string;
  maxZoom: number;
  styleId: string;
  useMaptilerProxy: boolean;
} {
  const resolved = resolveBasemapForStyle(config, styleIdInput);
  const apiKey = readMapApiKey(config);
  if (resolved.provider === "maptiler" && apiKey && resolved.styleId !== "osm") {
    const style = mapStyleById(resolved.styleId);
    return {
      imageryUrlTemplate: `/api/map/tiles/${style.id}/{z}/{x}/{y}.${style.tileFormat}`,
      attribution: resolved.attribution,
      maxZoom: 17,
      styleId: resolved.styleId,
      useMaptilerProxy: true,
    };
  }
  return {
    imageryUrlTemplate: resolved.lightUrl,
    attribution: resolved.attribution,
    maxZoom: Math.min(resolved.maxZoom, 17),
    styleId: resolved.styleId,
    useMaptilerProxy: false,
  };
}
