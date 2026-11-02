import type { AppConfig } from "@/lib/config/schema";

export type GlobeTerrainMode = "cesium-ion" | "maptiler" | "ellipsoid";

export type GlobeConfigResolved = {
  terrainMode: GlobeTerrainMode;
  /** Set on client when using Cesium ion world terrain / imagery. */
  cesiumIonAccessToken: string | null;
  /** MapTiler quantized mesh endpoint (includes key query param). */
  mapTilerTerrainUrl: string | null;
  /** Raster basemap for the globe (includes key when required). */
  imageryUrlTemplate: string;
  attribution: string;
  usingFallbackTerrain: boolean;
};

function readMapApiKey(config: AppConfig): string {
  const fromConfig = config.map?.apiKey?.trim() ?? "";
  const fromEnv = process.env.MAP_API_KEY?.trim() ?? "";
  return fromConfig || fromEnv;
}

function readCesiumIonToken(): string {
  return (
    process.env.CESIUM_ION_ACCESS_TOKEN?.trim() ??
    process.env.NEXT_PUBLIC_CESIUM_ION_ACCESS_TOKEN?.trim() ??
    ""
  );
}

const OSM_IMAGERY =
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const MAPTILER_ATTRIBUTION =
  '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Resolve 3D globe terrain + imagery from operator config (server-side). */
export function resolveGlobeConfig(config: AppConfig): GlobeConfigResolved {
  const ionToken = readCesiumIonToken();
  if (ionToken) {
    return {
      terrainMode: "cesium-ion",
      cesiumIonAccessToken: ionToken,
      mapTilerTerrainUrl: null,
      imageryUrlTemplate: "",
      attribution:
        '&copy; <a href="https://cesium.com/">Cesium</a> &copy; OpenStreetMap contributors',
      usingFallbackTerrain: false,
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
      imageryUrlTemplate: `https://api.maptiler.com/maps/hybrid/{z}/{x}/{y}.jpg?key=${key}`,
      attribution: MAPTILER_ATTRIBUTION,
      usingFallbackTerrain: false,
    };
  }

  return {
    terrainMode: "ellipsoid",
    cesiumIonAccessToken: null,
    mapTilerTerrainUrl: null,
    imageryUrlTemplate: OSM_IMAGERY,
    attribution: OSM_ATTRIBUTION,
    usingFallbackTerrain: true,
  };
}
