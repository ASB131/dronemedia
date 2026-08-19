"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CircleMarker, LatLngExpression, Map as LeafletMap } from "leaflet";
import { Film, ImageIcon, X } from "lucide-react";

import { AltitudeGraph } from "@/components/assets/altitude-graph";
import {
  useTelemetryCursor,
  type ScrubberMarker,
} from "@/components/assets/video-player";

const PhotoViewer = dynamic(
  () =>
    import("@/components/assets/photo-viewer").then((m) => m.PhotoViewer),
  { ssr: false },
);
const VideoPlayer = dynamic(
  () =>
    import("@/components/assets/video-player").then((m) => m.VideoPlayer),
  { ssr: false },
);
import { usePlaybackPreferences } from "@/hooks/use-playback-preferences";
import { useMapTheme } from "@/hooks/use-map-theme";
import type { TelemetrySeriesPoint } from "@/lib/assets/telemetry";
import { effectivePanoramaViewer } from "@/lib/assets/panorama-viewer-mode";
import { colorModeFromMediaMetadata } from "@/lib/luts/color-profile";
import {
  AUTO_EXPAND_ZOOM,
  COLOCATED_METERS,
  DISABLE_CLUSTERING_ZOOM,
  PATH_MIN_ZOOM,
  distanceMeters,
  layoutColocatedPositions,
} from "@/lib/map/colocated-layout";
import { prepareSmoothPath } from "@/lib/map/path-smooth";
import { basemapTileUrl } from "@/lib/map/tiles";
import type { MapAssetDto, MapFlightPathDto } from "@/lib/map/queries";
import { thumbnailMarkerHtml as buildThumbnailMarkerHtml } from "@/lib/map/marker-html";
import { MapShellSkeleton } from "@/components/ui/skeletons";
import { cn } from "@/lib/utils";

type AssetTypeFilter = "all" | "photo" | "video";

function thumbnailMarkerHtml(asset: MapAssetDto) {
  return buildThumbnailMarkerHtml(asset, `/api/assets/${asset.id}/thumbnail`);
}

async function loadLeafletWithCluster() {
  await import("leaflet");
  await import("leaflet/dist/leaflet.css");

  // leaflet.markercluster patches the browser global window.L (not the ESM
  // namespace object returned by import("leaflet")).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const L = window.L as any;
  if (!L) {
    throw new Error("Leaflet failed to initialize");
  }

  await import("leaflet.markercluster");
  await import("leaflet.markercluster/dist/MarkerCluster.css");
  await import("leaflet.markercluster/dist/MarkerCluster.Default.css");
  await import("leaflet.heat");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clustered = window.L as any;
  if (typeof clustered?.heatLayer !== "function") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const heatMod = (await import("leaflet.heat")) as any;
    if (typeof heatMod.heatLayer === "function") {
      clustered.heatLayer = heatMod.heatLayer;
    } else if (typeof heatMod.default === "function") {
      clustered.heatLayer = heatMod.default;
    }
  }
  if (typeof clustered?.markerClusterGroup !== "function") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import("leaflet.markercluster")) as any;
    if (mod.MarkerClusterGroup) {
      clustered.MarkerClusterGroup = mod.MarkerClusterGroup;
      clustered.markerClusterGroup = (options?: object) =>
        new mod.MarkerClusterGroup(options);
    }
  }

  if (typeof clustered?.markerClusterGroup !== "function") {
    throw new Error("Leaflet.markercluster failed to initialize");
  }

  return clustered as typeof import("leaflet") & {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    markerClusterGroup: (options?: object) => any;
  };
}

function boundsQuery(map: LeafletMap) {
  const bounds = map.getBounds().pad(0.15);
  return {
    north: bounds.getNorth(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    west: bounds.getWest(),
  };
}

export function MapView() {
  const playbackPrefs = usePlaybackPreferences();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const cursorMarkerRef = useRef<CircleMarker | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clusterRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const heatLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pathsLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tileLayerRef = useRef<any>(null);
  const onSelectRef = useRef<(asset: MapAssetDto) => void>(() => undefined);
  const previewOpenRef = useRef(false);
  const fittedRef = useRef(false);
  const typeFilterRef = useRef<AssetTypeFilter>("all");
  const assetsRef = useRef<MapAssetDto[]>([]);
  const markerLayoutKeyRef = useRef("");
  const syncAssetMarkersRef = useRef<(options?: { fitIfNeeded?: boolean }) => void>(
    () => undefined,
  );
  const mapTheme = useMapTheme();
  const [assets, setAssets] = useState<MapAssetDto[]>([]);
  const [flights, setFlights] = useState<MapFlightPathDto[]>([]);
  const [showPaths, setShowPaths] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [pathRedrawToken, setPathRedrawToken] = useState(0);
  const showPathsRef = useRef(showPaths);
  showPathsRef.current = showPaths;
  const showHeatmapRef = useRef(showHeatmap);
  showHeatmapRef.current = showHeatmap;
  const [typeFilter, setTypeFilter] = useState<AssetTypeFilter>("all");
  const [mapBooted, setMapBooted] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [preview, setPreview] = useState<MapAssetDto | null>(null);
  const [allowInAppSource, setAllowInAppSource] = useState(true);
  const [series, setSeries] = useState<TelemetrySeriesPoint[]>([]);
  const [scrubberMarkers, setScrubberMarkers] = useState<ScrubberMarker[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [contextPoint, setContextPoint] = useState<{
    lat: number;
    lng: number;
    label: string;
    at: string | null;
  } | null>(null);
  const [weather, setWeather] = useState<{
    temperatureC: number | null;
    windSpeedKmh: number | null;
    windDirectionDeg: number | null;
  } | null>(null);
  typeFilterRef.current = typeFilter;
  assetsRef.current = assets;

  onSelectRef.current = (asset) => setPreview(asset);
  previewOpenRef.current = Boolean(preview);

  function syncAssetMarkers(options?: { fitIfNeeded?: boolean }) {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    const cluster = clusterRef.current;
    if (!map || !L || !cluster) return;
    if (showHeatmapRef.current) {
      cluster.clearLayers();
      return;
    }

    const currentAssets = assetsRef.current;
    const zoom = map.getZoom();
    const expand = zoom >= AUTO_EXPAND_ZOOM;
    const assetKey = currentAssets.map((asset) => asset.id).join(",");
    const layoutKey = expand ? `e:${zoom}:${assetKey}` : `c:${assetKey}`;
    if (
      layoutKey === markerLayoutKeyRef.current &&
      cluster.getLayers().length === currentAssets.length
    ) {
      return;
    }
    markerLayoutKeyRef.current = layoutKey;

    const positions = layoutColocatedPositions(currentAssets, {
      expand,
      project: (latLng) => map.latLngToLayerPoint(latLng),
      unproject: (point) => map.layerPointToLatLng(L.point(point.x, point.y)),
    });

    cluster.clearLayers();
    const bounds: LatLngExpression[] = [];
    for (const asset of currentAssets) {
      const position = positions.get(asset.id) ?? {
        lat: asset.lat,
        lng: asset.lng,
      };
      const marker = L.marker([position.lat, position.lng], {
        icon: L.divIcon({
          html: thumbnailMarkerHtml(asset),
          className: "dm-map-marker-wrap",
          iconSize: [48, 48],
          iconAnchor: [24, 24],
        }),
      });
      marker.on("click", () => onSelectRef.current(asset));
      cluster.addLayer(marker);
      bounds.push([asset.lat, asset.lng]);
    }

    if (options?.fitIfNeeded && !fittedRef.current && bounds.length > 0) {
      if (bounds.length === 1) {
        map.setView(bounds[0] as [number, number], 13);
      } else {
        map.fitBounds(L.latLngBounds(bounds).pad(0.2));
      }
      fittedRef.current = true;
    }
  }
  syncAssetMarkersRef.current = syncAssetMarkers;

  const colocatedAtPreview = useMemo(() => {
    if (!preview) return [] as MapAssetDto[];
    return assets
      .filter((asset) => distanceMeters(asset, preview) <= COLOCATED_METERS)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [assets, preview]);

  const cursor = useTelemetryCursor(series, currentTime);

  async function fetchAssetsForMap(
    map: LeafletMap | null,
    filter: AssetTypeFilter,
    heatmap = showHeatmapRef.current,
  ) {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("type", filter);
    if (heatmap) {
      params.set("heatmap", "1");
      params.set("limit", "8000");
    } else if (map && fittedRef.current) {
      const box = boundsQuery(map);
      params.set("north", String(box.north));
      params.set("south", String(box.south));
      params.set("east", String(box.east));
      params.set("west", String(box.west));
      params.set("limit", "800");
    } else {
      params.set("limit", "400");
    }
    setLoadingAssets(true);
    const response = await fetch(`/api/map/assets?${params.toString()}`);
    setLoadingAssets(false);
    if (!response.ok) {
      setError("Failed to load map data");
      return;
    }
    const payload = (await response.json()) as { assets: MapAssetDto[] };
    setAssets(payload.assets);
    setError(null);
  }

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const [flightsRes, accountRes] = await Promise.all([
        fetch("/api/map/flights"),
        fetch("/api/account"),
        fetchAssetsForMap(null, typeFilterRef.current),
      ]);
      if (accountRes.ok) {
        const account = (await accountRes.json()) as {
          allowInAppSource?: boolean;
        };
        if (mounted) setAllowInAppSource(account.allowInAppSource !== false);
      }
      if (!mounted) return;
      if (flightsRes.ok) {
        const flightsPayload = (await flightsRes.json()) as {
          flights: MapFlightPathDto[];
        };
        setFlights(flightsPayload.flights);
      }
      // Mount the map container only after the first fetch so we don't flash
      // the empty state (which unmounts mapRef and skips Leaflet init).
      setInitialLoadDone(true);
      setMapBooted(true);
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapBooted) return;
    void fetchAssetsForMap(mapInstanceRef.current, typeFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, mapBooted]);

  useEffect(() => {
    if (!preview || preview.assetType !== "video") {
      setSeries([]);
      setScrubberMarkers([]);
      setCurrentTime(0);
      return;
    }

    let mounted = true;
    setSeries([]);
    setScrubberMarkers([]);
    setCurrentTime(0);

    void (async () => {
      const [telemetryRes, chaptersRes] = await Promise.all([
        fetch(`/api/assets/${preview.id}/telemetry?series=1`),
        fetch(`/api/assets/${preview.id}/export?format=chapters`),
      ]);
      if (!mounted) return;
      if (telemetryRes.ok) {
        const payload = (await telemetryRes.json()) as {
          series?: TelemetrySeriesPoint[];
        };
        setSeries(payload.series ?? []);
      }
      if (chaptersRes.ok) {
        const payload = (await chaptersRes.json()) as {
          chapters?: ScrubberMarker[];
        };
        setScrubberMarkers(
          (payload.chapters ?? []).filter((chapter) =>
            /max altitude/i.test(chapter.label),
          ),
        );
      }
    })();

    return () => {
      mounted = false;
    };
  }, [preview]);

  useEffect(() => {
    if (!contextPoint?.at) {
      setWeather(null);
      return;
    }
    let mounted = true;
    void (async () => {
      const response = await fetch(
        `/api/weather?lat=${contextPoint.lat}&lng=${contextPoint.lng}&at=${encodeURIComponent(contextPoint.at!)}`,
      );
      if (!response.ok || !mounted) return;
      const payload = (await response.json()) as {
        temperatureC: number | null;
        windSpeedKmh: number | null;
        windDirectionDeg: number | null;
      };
      if (mounted) setWeather(payload);
    })();
    return () => {
      mounted = false;
    };
  }, [contextPoint]);

  // Create map once after initial boot.
  useEffect(() => {
    if (!mapBooted || !mapRef.current || mapInstanceRef.current) return;

    let disposed = false;
    let moveTimer: ReturnType<typeof setTimeout> | null = null;

    async function initMap() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let L: any;
      try {
        L = await loadLeafletWithCluster();
      } catch {
        if (!disposed) setError("Map clustering failed to load");
        return;
      }
      if (disposed || !mapRef.current) return;

      leafletRef.current = L;
      const seedLat =
        assets[0]?.lat ?? flights[0]?.coordinates[0]?.[1] ?? 51.5;
      const seedLng =
        assets[0]?.lng ?? flights[0]?.coordinates[0]?.[0] ?? -0.12;

      const map = L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: false,
      }).setView([seedLat, seedLng], 12);
      tileLayerRef.current = L.tileLayer(basemapTileUrl(mapTheme), {
        attribution: "",
        maxZoom: 20,
      }).addTo(map);

      // Cluster while zoomed out; at AUTO_EXPAND_ZOOM markers are placed
      // individually (with co-located pins fanned out) so each is clickable.
      clusterRef.current = L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 56,
        spiderfyOnMaxZoom: true,
        zoomToBoundsOnClick: true,
        disableClusteringAtZoom: DISABLE_CLUSTERING_ZOOM,
        spiderfyDistanceMultiplier: 3.2,
        spiderLegPolylineOptions: {
          weight: 1.5,
          color: "#64748b",
          opacity: 0.75,
        },
        iconCreateFunction: (cluster: { getChildCount: () => number }) => {
          const count = cluster.getChildCount();
          const size = count < 10 ? "sm" : count < 50 ? "md" : "lg";
          const px = size === "lg" ? 52 : size === "md" ? 44 : 36;
          return L.divIcon({
            html: `<div class="dm-map-cluster dm-map-cluster-${size}"><span>${count}</span></div>`,
            className: "dm-map-cluster-wrap",
            iconSize: L.point(px, px),
          });
        },
      });
      pathsLayerRef.current = L.layerGroup().addTo(map);
      map.addLayer(clusterRef.current);

      map.on("zoomend", () => {
        syncAssetMarkersRef.current();
        setPathRedrawToken((value) => value + 1);
      });

      map.on("moveend", () => {
        setPathRedrawToken((value) => value + 1);
        if (!fittedRef.current) return;
        if (showHeatmapRef.current) return;
        if (moveTimer) clearTimeout(moveTimer);
        moveTimer = setTimeout(() => {
          void fetchAssetsForMap(map, typeFilterRef.current);
        }, 350);
      });

      mapInstanceRef.current = map;
      markerLayoutKeyRef.current = "";
      syncAssetMarkersRef.current({ fitIfNeeded: true });
      if (previewOpenRef.current) {
        window.requestAnimationFrame(() => {
          map.invalidateSize({ animate: false });
        });
      }
    }

    void initMap();

    return () => {
      disposed = true;
      if (moveTimer) clearTimeout(moveTimer);
      cursorMarkerRef.current = null;
      clusterRef.current = null;
      pathsLayerRef.current = null;
      heatLayerRef.current = null;
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
      fittedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapBooted]);

  // Theme tiles
  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    tileLayerRef.current = L.tileLayer(basemapTileUrl(mapTheme), {
      attribution: "",
      maxZoom: 20,
    }).addTo(map);
  }, [mapTheme]);

  // Sync asset markers (also re-layouts on zoom via zoomend in initMap).
  useEffect(() => {
    markerLayoutKeyRef.current = "";
    syncAssetMarkers({ fitIfNeeded: !showHeatmap });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, showHeatmap]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    if (heatLayerRef.current) {
      map.removeLayer(heatLayerRef.current);
      heatLayerRef.current = null;
    }

    if (showHeatmap) {
      if (clusterRef.current && map.hasLayer(clusterRef.current)) {
        map.removeLayer(clusterRef.current);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const heatFactory = (L as any).heatLayer;
      if (typeof heatFactory === "function") {
        const points = assetsRef.current.map(
          (asset) => [asset.lat, asset.lng, 0.65] as [number, number, number],
        );
        heatLayerRef.current = heatFactory(points, {
          radius: 28,
          blur: 22,
          maxZoom: 17,
          minOpacity: 0.35,
        }).addTo(map);
      }
    } else if (clusterRef.current && !map.hasLayer(clusterRef.current)) {
      map.addLayer(clusterRef.current);
      markerLayoutKeyRef.current = "";
      syncAssetMarkersRef.current();
    }
  }, [showHeatmap, assets]);

  useEffect(() => {
    if (!mapBooted) return;
    void fetchAssetsForMap(mapInstanceRef.current, typeFilter, showHeatmap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHeatmap]);

  // Sync flight paths (close zoom + viewport cull only)
  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    const layer = pathsLayerRef.current;
    if (!map || !L || !layer) return;
    layer.clearLayers();
    if (!showPaths || map.getZoom() < PATH_MIN_ZOOM) return;

    const viewBounds = map.getBounds().pad(0.2);
    for (const flight of flights) {
      const raw = flight.coordinates.map(
        ([lng, lat]) => [lng, lat] as [number, number],
      );
      const visible = raw.some(([lng, lat]) =>
        viewBounds.contains(L.latLng(lat, lng)),
      );
      if (!visible) continue;

      const smoothed = prepareSmoothPath(raw);
      const drawLatLngs = smoothed.map(
        ([lng, lat]) => [lat, lng] as LatLngExpression,
      );
      if (drawLatLngs.length < 2) continue;
      const line = L.polyline(drawLatLngs, {
        color: mapTheme === "dark" ? "#5b8def" : "#0ea5e9",
        weight: 3,
        opacity: 0.75,
        lineJoin: "round",
        lineCap: "round",
        smoothFactor: 2,
      });
      line.on("click", () => {
        const asset = assets.find((item) => item.id === flight.assetId);
        if (asset) onSelectRef.current(asset);
      });
      layer.addLayer(line);
    }
  }, [flights, showPaths, assets, mapTheme, pathRedrawToken]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const frame = window.requestAnimationFrame(() => {
      map.invalidateSize({ animate: false });
      if (preview) {
        map.panTo([preview.lat, preview.lng], { animate: true });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [preview]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    if (!preview || preview.assetType !== "video" || !cursor) {
      if (cursorMarkerRef.current) {
        cursorMarkerRef.current.remove();
        cursorMarkerRef.current = null;
      }
      return;
    }

    const latLng: LatLngExpression = [cursor.lat, cursor.lng];
    if (!cursorMarkerRef.current) {
      cursorMarkerRef.current = L.circleMarker(latLng, {
        radius: 7,
        color: "#f97316",
        fillColor: "#fb923c",
        fillOpacity: 0.95,
        weight: 2,
      }).addTo(map);
    } else {
      cursorMarkerRef.current.setLatLng(latLng);
    }
  }, [cursor, preview]);

  const empty =
    initialLoadDone &&
    assets.length === 0 &&
    flights.length === 0 &&
    typeFilter === "all";

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">Map</h1>
          <p className="text-xs text-muted-foreground">
            {!initialLoadDone
              ? "Loading map…"
              : `${assets.length} geotagged asset${assets.length === 1 ? "" : "s"}${
                  loadingAssets ? " · updating…" : " in view"
                }${
                  flights.length > 0
                    ? ` · ${flights.length} flight path${flights.length === 1 ? "" : "s"}`
                    : ""
                }`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex overflow-hidden rounded-full border border-border text-xs">
            {(
              [
                ["all", "All"],
                ["photo", "Photos"],
                ["video", "Videos"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTypeFilter(value)}
                className={cn(
                  "px-2.5 py-1.5",
                  typeFilter === value
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {flights.length > 0 ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={showPaths}
                onChange={(event) => setShowPaths(event.target.checked)}
              />
              Paths
              <span className="text-[10px] opacity-70">(close zoom)</span>
            </label>
          ) : null}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showHeatmap}
              onChange={(event) => setShowHeatmap(event.target.checked)}
            />
            Heatmap
          </label>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {contextPoint ? (
          <div className="absolute left-3 top-3 z-[500] w-[min(20rem,calc(100%-1.5rem))] space-y-2 rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
            <div className="space-y-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">{contextPoint.label}</p>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setContextPoint(null)}
                >
                  <X className="size-4" />
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {contextPoint.lat.toFixed(5)}, {contextPoint.lng.toFixed(5)}
              </p>
              {weather ? (
                <p className="text-xs text-muted-foreground">
                  Weather at capture:{" "}
                  {weather.temperatureC != null
                    ? `${weather.temperatureC.toFixed(1)}°C`
                    : "—"}
                  {weather.windSpeedKmh != null
                    ? ` · wind ${weather.windSpeedKmh.toFixed(0)} km/h`
                    : ""}
                  {weather.windDirectionDeg != null
                    ? ` @ ${Math.round(weather.windDirectionDeg)}°`
                    : ""}
                </p>
              ) : contextPoint.at ? (
                <p className="text-xs text-muted-foreground">
                  Loading weather…
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
        {!initialLoadDone ? (
          <MapShellSkeleton className="h-full min-h-0" />
        ) : error ? (
          <p className="p-4 text-sm text-destructive">{error}</p>
        ) : empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No geotagged media yet. Upload videos with SRT sidecars or add GPS
              metadata to see assets on the map.
            </p>
            <Link href="/" className="text-sm text-primary hover:underline">
              Back to timeline
            </Link>
          </div>
        ) : (
          <div className="flex h-full min-h-0">
            <div
              className={`relative min-h-0 min-w-0 ${preview ? "w-1/2" : "w-full"}`}
            >
              <div ref={mapRef} className="h-full w-full" />
            </div>
            {preview ? (
              <aside className="flex w-1/2 min-w-0 shrink-0 flex-col border-l border-border bg-background">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {preview.displayName}
                    </p>
                    <p className="text-xs capitalize text-muted-foreground">
                      {preview.assetType}
                      {colocatedAtPreview.length > 1
                        ? ` · ${colocatedAtPreview.length} at this spot`
                        : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close preview"
                    className="inline-flex size-8 items-center justify-center rounded-full hover:bg-muted"
                    onClick={() => setPreview(null)}
                  >
                    <X className="size-4" />
                  </button>
                </div>
                {colocatedAtPreview.length > 1 ? (
                  <div className="flex gap-2 overflow-x-auto border-b border-border px-3 py-2">
                    {colocatedAtPreview.map((asset) => {
                      const active = asset.id === preview.id;
                      return (
                        <button
                          key={asset.id}
                          type="button"
                          title={asset.displayName}
                          aria-label={`Select ${asset.displayName}`}
                          aria-pressed={active}
                          className={cn(
                            "relative size-12 shrink-0 overflow-hidden rounded-full border-2 bg-muted",
                            active
                              ? "border-primary ring-2 ring-primary/30"
                              : "border-transparent opacity-80 hover:opacity-100",
                          )}
                          onClick={() => setPreview(asset)}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/assets/${asset.id}/thumbnail`}
                            alt=""
                            className="size-full object-cover"
                          />
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <div className="relative min-h-0 flex-1 bg-black">
                  {(() => {
                    const panoMode = effectivePanoramaViewer({
                      assetType: preview.assetType,
                      sequenceKind: preview.sequenceKind,
                      mediaMetadata: preview.mediaMetadata,
                    });
                    const isPanoSequence =
                      preview.assetType === "sequence" &&
                      preview.sequenceKind === "panorama";

                    // 180°: flat equirect image. 360°: first tile preview only.
                    if (panoMode === "180") {
                      return (
                        <PhotoViewer
                          key={`${preview.id}-180`}
                          src={`/api/assets/${preview.id}/pano?full=1`}
                          sourceSrc={
                            allowInAppSource
                              ? `/api/assets/${preview.id}/original?playback=source`
                              : null
                          }
                          alt={preview.displayName}
                          className="absolute inset-0 size-full"
                        />
                      );
                    }

                    if (panoMode === "360" || isPanoSequence) {
                      const tileSrc =
                        (preview.frameCount ?? 0) > 0
                          ? `/api/assets/${preview.id}/frames/0?thumb=1`
                          : `/api/assets/${preview.id}/thumbnail`;
                      return (
                        <Link
                          href={`/assets/${preview.id}`}
                          className="absolute inset-0 block"
                          title="Open 360° panorama"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={tileSrc}
                            alt={preview.displayName}
                            className="size-full object-contain"
                          />
                          <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-3 pt-10 text-center text-xs font-medium text-white">
                            360° · Open full panorama
                          </span>
                        </Link>
                      );
                    }

                    if (preview.assetType === "photo") {
                      return (
                        <PhotoViewer
                          src={`/api/assets/${preview.id}/original`}
                          sourceSrc={
                            allowInAppSource
                              ? `/api/assets/${preview.id}/original?playback=source`
                              : null
                          }
                          alt={preview.displayName}
                          lutId={
                            colorModeFromMediaMetadata(preview.mediaMetadata)
                              ? preview.preferredLutId
                              : null
                          }
                          className="absolute inset-0 size-full"
                        />
                      );
                    }

                    return (
                      <VideoPlayer
                        key={preview.id}
                        src={`/api/assets/${preview.id}/original`}
                        hlsSrc={
                          preview.hasHls
                            ? `/api/assets/${preview.id}/hls/index.m3u8`
                            : null
                        }
                        sourceSrc={
                          allowInAppSource
                            ? `/api/assets/${preview.id}/original?playback=source`
                            : null
                        }
                        defaultResolution={
                          allowInAppSource
                            ? playbackPrefs.defaultPlaybackResolution
                            : playbackPrefs.defaultPlaybackResolution ===
                                "source"
                              ? "1080"
                              : playbackPrefs.defaultPlaybackResolution
                        }
                        enabledHeights={playbackPrefs.enabledPreviewHeights}
                        previewQualitiesDisabled={
                          playbackPrefs.previewQualitiesDisabled &&
                          !allowInAppSource
                        }
                        lutId={
                          colorModeFromMediaMetadata(preview.mediaMetadata)
                            ? preview.preferredLutId
                            : null
                        }
                        scrubberMarkers={scrubberMarkers}
                        className="absolute inset-0 size-full"
                        onTimeUpdate={(time) => setCurrentTime(time)}
                      />
                    );
                  })()}
                </div>
                {preview.assetType === "video" &&
                preview.sequenceKind !== "panorama" &&
                series.length > 0 ? (
                  <div className="border-t border-border px-3 py-2">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Altitude
                    </p>
                    <AltitudeGraph
                      series={series}
                      currentOffsetMs={currentTime * 1000}
                    />
                  </div>
                ) : null}
                <div className="flex items-center gap-2 border-t border-border p-3">
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    {preview.assetType === "video" &&
                    preview.sequenceKind !== "panorama" ? (
                      <Film className="size-3.5" />
                    ) : (
                      <ImageIcon className="size-3.5" />
                    )}
                    {effectivePanoramaViewer({
                      assetType: preview.assetType,
                      sequenceKind: preview.sequenceKind,
                      mediaMetadata: preview.mediaMetadata,
                    }) === "360"
                      ? "360° preview"
                      : effectivePanoramaViewer({
                            assetType: preview.assetType,
                            sequenceKind: preview.sequenceKind,
                            mediaMetadata: preview.mediaMetadata,
                          }) === "180"
                        ? "180° panorama"
                        : "Preview"}
                  </span>
                  <Link
                    href={`/assets/${preview.id}`}
                    className="ml-auto inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90"
                  >
                    Open full page
                  </Link>
                </div>
              </aside>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
