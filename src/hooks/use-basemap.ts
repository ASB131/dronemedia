"use client";

import { useEffect, useState } from "react";

import { basemapUrlForTheme, type BasemapResolved } from "@/lib/map/basemap";
import type { MapTheme } from "@/lib/map/tiles";

export type BasemapClientConfig = BasemapResolved;

const OSM_FALLBACK: BasemapClientConfig = {
  provider: "osm",
  lightUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  darkUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  usingFallback: true,
  apiKeyConfigured: false,
};

let cached: BasemapClientConfig | null = null;
let inflight: Promise<BasemapClientConfig> | null = null;

export function invalidateBasemapCache() {
  cached = null;
  inflight = null;
}

async function fetchBasemap(): Promise<BasemapClientConfig> {
  if (cached) return cached;
  if (!inflight) {
    inflight = (async () => {
      try {
        const response = await fetch("/api/map/basemap");
        if (!response.ok) return OSM_FALLBACK;
        const payload = (await response.json()) as BasemapClientConfig;
        cached = payload;
        return payload;
      } catch {
        return OSM_FALLBACK;
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}

export function useBasemap(): BasemapClientConfig {
  const [config, setConfig] = useState<BasemapClientConfig>(
    () => cached ?? OSM_FALLBACK,
  );

  useEffect(() => {
    void fetchBasemap().then(setConfig);
  }, []);

  return config;
}

export function useBasemapTileUrl(theme: MapTheme): string {
  const basemap = useBasemap();
  return basemapUrlForTheme(basemap, theme);
}
