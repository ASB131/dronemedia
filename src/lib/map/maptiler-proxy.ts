import type { AppConfig } from "@/lib/config/schema";

import { readMapApiKey } from "@/lib/map/basemap";
import type { MapStyleDefinition } from "@/lib/map/map-styles";

export function maptilerApiKey(config: AppConfig): string | null {
  const key = readMapApiKey(config);
  return key.trim() || null;
}

export function upstreamMaptilerTileUrl(
  style: MapStyleDefinition,
  z: number,
  x: number,
  y: number,
  apiKey: string,
): string {
  const mapId = style.maptilerId ?? "hybrid";
  return `https://api.maptiler.com/maps/${mapId}/${z}/${x}/${y}.${style.tileFormat}?key=${encodeURIComponent(apiKey)}`;
}

export function lonLatToTileXY(
  lng: number,
  lat: number,
  zoom: number,
): { x: number; y: number; z: number } {
  const z = Math.max(0, Math.min(22, Math.floor(zoom)));
  const scale = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * scale);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      scale,
  );
  return {
    x: Math.max(0, Math.min(scale - 1, x)),
    y: Math.max(0, Math.min(scale - 1, y)),
    z,
  };
}
