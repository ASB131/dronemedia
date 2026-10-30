import type { AppConfig } from "@/lib/config/schema";

export type MapBasemapProvider = "carto" | "maptiler" | "osm";

export type BasemapResolved = {
  provider: MapBasemapProvider;
  lightUrl: string;
  darkUrl: string;
  attribution: string;
  /** True when a keyed provider was chosen but no key is configured. */
  usingFallback: boolean;
  apiKeyConfigured: boolean;
};

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

const MAPTILER_ATTRIBUTION =
  '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function osmBasemap(): BasemapResolved {
  const url = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  return {
    provider: "osm",
    lightUrl: url,
    darkUrl: url,
    attribution: OSM_ATTRIBUTION,
    usingFallback: false,
    apiKeyConfigured: false,
  };
}

function readMapApiKey(config: AppConfig): string {
  const fromConfig = config.map?.apiKey?.trim() ?? "";
  const fromEnv = process.env.MAP_API_KEY?.trim() ?? "";
  return fromConfig || fromEnv;
}

/** Resolve tile URLs from operator config (server-side). */
export function resolveBasemapConfig(config: AppConfig): BasemapResolved {
  const provider = config.map?.provider ?? "carto";
  const apiKey = readMapApiKey(config);

  if (provider === "osm") {
    return osmBasemap();
  }

  if (!apiKey) {
    return {
      ...osmBasemap(),
      usingFallback: true,
      apiKeyConfigured: false,
    };
  }

  if (provider === "maptiler") {
    const key = encodeURIComponent(apiKey);
    return {
      provider: "maptiler",
      lightUrl: `https://api.maptiler.com/maps/bright-v2/{z}/{x}/{y}.png?key=${key}`,
      darkUrl: `https://api.maptiler.com/maps/dataviz-dark/{z}/{x}/{y}.png?key=${key}`,
      attribution: MAPTILER_ATTRIBUTION,
      usingFallback: false,
      apiKeyConfigured: true,
    };
  }

  const q = `?api_key=${encodeURIComponent(apiKey)}`;
  return {
    provider: "carto",
    lightUrl: `https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png${q}`,
    darkUrl: `https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png${q}`,
    attribution: CARTO_ATTRIBUTION,
    usingFallback: false,
    apiKeyConfigured: true,
  };
}

export function basemapUrlForTheme(
  resolved: BasemapResolved,
  theme: "light" | "dark",
): string {
  return theme === "dark" ? resolved.darkUrl : resolved.lightUrl;
}
