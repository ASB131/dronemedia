"use client";

import { useEffect, useState } from "react";

import type { GlobeTerrainMode } from "@/lib/map/globe-config";

export type GlobeConfigClient = {
  terrainMode: GlobeTerrainMode;
  cesiumIonAccessToken: string | null;
  mapTilerTerrainUrl: string | null;
  imageryUrlTemplate: string;
  imageryMaxZoom: number;
  attribution: string;
  usingFallbackTerrain: boolean;
  mapStyleId: string;
  loading: boolean;
  error: string | null;
};

const DEFAULT: GlobeConfigClient = {
  terrainMode: "ellipsoid",
  cesiumIonAccessToken: null,
  mapTilerTerrainUrl: null,
  imageryUrlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "",
  usingFallbackTerrain: true,
  imageryMaxZoom: 19,
  mapStyleId: "hybrid",
  loading: true,
  error: null,
};

export function invalidateGlobeConfigCache() {
  /* globe hook refetches on dm-preferences; no module cache yet */
}

export function useGlobeConfig(): GlobeConfigClient {
  const [state, setState] = useState<GlobeConfigClient>(DEFAULT);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/map/globe");
        if (!response.ok) {
          throw new Error("Failed to load globe settings");
        }
        const payload = (await response.json()) as Omit<
          GlobeConfigClient,
          "loading" | "error"
        >;
        if (!cancelled) {
          setState({
            ...payload,
            loading: false,
            error: null,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            ...DEFAULT,
            loading: false,
            error: error instanceof Error ? error.message : "Globe unavailable",
          });
        }
      }
    }

    void load();
    function onPrefs() {
      void load();
    }
    window.addEventListener("dm-preferences", onPrefs);
    return () => {
      cancelled = true;
      window.removeEventListener("dm-preferences", onPrefs);
    };
  }, []);

  return state;
}
