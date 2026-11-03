import type { AppConfig } from "@/lib/config/schema";

import { readMapApiKey } from "@/lib/map/basemap";
import { resolveImageryTemplateForStyle } from "@/lib/map/map-styles";

export type GlobeTerrainMode = "cesium-ion" | "maptiler" | "ellipsoid";

export type GlobeConfigResolved = {
  terrainMode: GlobeTerrainMode;
  cesiumIonAccessToken: string | null;
  mapTilerTerrainUrl: string | null;
  imageryUrlTemplate: string;
  imageryMaxZoom: number;
  attribution: string;
  usingFallbackTerrain: boolean;
  mapStyleId: string;
};

function readCesiumIonToken(): string {
  return (
    process.env.CESIUM_ION_ACCESS_TOKEN?.trim() ??
    process.env.NEXT_PUBLIC_CESIUM_ION_ACCESS_TOKEN?.trim() ??
    ""
  );
}

/** Resolve 3D globe terrain + imagery (server-side). */
export function resolveGlobeConfig(
  config: AppConfig,
  mapStyleId: string | null | undefined,
): GlobeConfigResolved {
  const imagery = resolveImageryTemplateForStyle(config, mapStyleId);
  const ionToken = readCesiumIonToken();
  if (ionToken) {
    return {
      terrainMode: "cesium-ion",
      cesiumIonAccessToken: ionToken,
      mapTilerTerrainUrl: null,
      imageryUrlTemplate: "",
      imageryMaxZoom: 22,
      attribution:
        '&copy; <a href="https://cesium.com/">Cesium</a> &copy; OpenStreetMap contributors',
      usingFallbackTerrain: false,
      mapStyleId: imagery.styleId,
    };
  }

  const provider = config.map?.provider ?? "carto";
  const apiKey = readMapApiKey(config);

  if (provider === "maptiler" && apiKey) {
    const key = encodeURIComponent(apiKey);
    return {
      terrainMode: "maptiler",
      cesiumIonAccessToken: null,
      mapTilerTerrainUrl: `https://api.maptiler.com/tiles/terrain-quantized-mesh-v2/?key=${key}`,
      imageryUrlTemplate: imagery.imageryUrlTemplate,
      imageryMaxZoom: imagery.maxZoom,
      attribution: imagery.attribution,
      usingFallbackTerrain: false,
      mapStyleId: imagery.styleId,
    };
  }

  return {
    terrainMode: "ellipsoid",
    cesiumIonAccessToken: null,
    mapTilerTerrainUrl: null,
    imageryUrlTemplate: imagery.imageryUrlTemplate,
    imageryMaxZoom: imagery.maxZoom,
    attribution: imagery.attribution,
    usingFallbackTerrain: true,
    mapStyleId: imagery.styleId,
  };
}
