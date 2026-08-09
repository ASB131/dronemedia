"use client";

import { useEffect, useRef, useState } from "react";

import { useMapTheme } from "@/hooks/use-map-theme";
import { pathColorForIndex } from "@/lib/map/path-colors";
import { prepareSmoothPath } from "@/lib/map/path-smooth";
import { basemapAttribution, basemapTileUrl } from "@/lib/map/tiles";
import type { LineStringGeoJson } from "@/lib/assets/telemetry";

export type FlightPathSegment = {
  assetId: string;
  /** GeoJSON order: [lng, lat] */
  coordinates: Array<[number, number]>;
};

export type FlightLocationMarker = {
  id: string;
  lat: number;
  lng: number;
  kind: "drone" | "photo";
};

function droneIconHtml() {
  return `<div class="dm-drone-marker" title="Drone">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="6" cy="6" r="2.25"/>
      <circle cx="18" cy="6" r="2.25"/>
      <circle cx="6" cy="18" r="2.25"/>
      <circle cx="18" cy="18" r="2.25"/>
      <rect x="9" y="9" width="6" height="6" rx="1.2"/>
      <path d="M8.2 8.2 9.8 9.8M15.8 8.2 14.2 9.8M8.2 15.8 9.8 14.2M15.8 15.8 14.2 14.2"/>
    </svg>
  </div>`;
}

function photoIconHtml() {
  return `<div class="dm-photo-marker" title="Photo">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  </div>`;
}

function resolveSeedView(params: {
  flightPath?: LineStringGeoJson | null;
  pathSegments?: FlightPathSegment[];
  locationMarkers?: FlightLocationMarker[];
  currentPosition?: { lat: number; lng: number } | null;
}): { center: [number, number]; zoom: number } | null {
  const coords =
    params.pathSegments?.flatMap((segment) => segment.coordinates) ??
    params.flightPath?.coordinates ??
    [];

  const markerLats = params.locationMarkers?.map((m) => m.lat) ?? [];
  const markerLngs = params.locationMarkers?.map((m) => m.lng) ?? [];

  // Prefer path extent when available so flights don't seed on the marker only.
  if (coords.length > 1) {
    const lats = [...coords.map((point) => point[1]), ...markerLats];
    const lngs = [...coords.map((point) => point[0]), ...markerLngs];
    return {
      center: [
        (Math.min(...lats) + Math.max(...lats)) / 2,
        (Math.min(...lngs) + Math.max(...lngs)) / 2,
      ],
      zoom: 13,
    };
  }
  if (coords.length === 1) {
    return { center: [coords[0]![1], coords[0]![0]], zoom: 15 };
  }

  if (markerLats.length > 1) {
    return {
      center: [
        (Math.min(...markerLats) + Math.max(...markerLats)) / 2,
        (Math.min(...markerLngs) + Math.max(...markerLngs)) / 2,
      ],
      zoom: 14,
    };
  }
  if (markerLats.length === 1) {
    return { center: [markerLats[0]!, markerLngs[0]!], zoom: 15 };
  }

  if (params.currentPosition) {
    return {
      center: [params.currentPosition.lat, params.currentPosition.lng],
      zoom: 15,
    };
  }
  return null;
}

export function FlightPathPreview({
  flightPath,
  pathSegments,
  locationMarkers,
  activeAssetId,
  currentPosition,
  markerKind = "drone",
  onPathClick,
  onMarkerClick,
  className,
}: {
  flightPath?: LineStringGeoJson | null;
  pathSegments?: FlightPathSegment[];
  locationMarkers?: FlightLocationMarker[];
  activeAssetId?: string | null;
  currentPosition?: { lat: number; lng: number } | null;
  markerKind?: "drone" | "photo";
  onPathClick?: (lat: number, lng: number) => void;
  onMarkerClick?: (assetId: string) => void;
  className?: string;
}) {
  const theme = useMapTheme();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<import("leaflet").Map | null>(null);
  const markerRef = useRef<import("leaflet").Marker | null>(null);
  const tileLayerRef = useRef<import("leaflet").TileLayer | null>(null);
  const pathsLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const locationsLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const fittedRef = useRef(false);
  const fittedPathKeyRef = useRef<string>("");
  const onPathClickRef = useRef(onPathClick);
  onPathClickRef.current = onPathClick;
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;

  const [mapReady, setMapReady] = useState(0);

  const hasSegments = Boolean(pathSegments && pathSegments.length > 0);
  const hasPath = Boolean(flightPath?.coordinates.length) || hasSegments;
  const hasLocations = Boolean(locationMarkers && locationMarkers.length > 0);
  const hasCursor = Boolean(currentPosition);
  const canShow = hasPath || hasLocations || hasCursor;

  // Create map once data is available
  useEffect(() => {
    if (!mapRef.current || !canShow || mapInstanceRef.current) return;

    let disposed = false;

    async function initMap() {
      await import("leaflet");
      const L = window.L;
      await import("leaflet/dist/leaflet.css");
      if (!L || disposed || !mapRef.current) return;

      const seed = resolveSeedView({
        flightPath,
        pathSegments,
        locationMarkers,
        currentPosition,
      });

      const map = L.map(mapRef.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: true,
        fadeAnimation: false,
        zoomAnimation: true,
        markerZoomAnimation: false,
      }).setView(seed?.center ?? [0, 0], seed?.zoom ?? 2);

      tileLayerRef.current = L.tileLayer(basemapTileUrl(theme), {
        attribution: basemapAttribution(),
        maxZoom: 20,
      }).addTo(map);

      pathsLayerRef.current = L.layerGroup().addTo(map);
      locationsLayerRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
      // Only treat single-point seeds as "fitted". Path bounds are applied
      // after polylines are drawn so full flight paths zoom correctly.
      const hasPathData =
        Boolean(pathSegments && pathSegments.length > 0) ||
        Boolean(flightPath?.coordinates?.length);
      if (seed && !hasPathData && !hasLocations) fittedRef.current = true;

      map.on("click", (event: { latlng: { lat: number; lng: number } }) => {
        onPathClickRef.current?.(event.latlng.lat, event.latlng.lng);
      });

      const resize = () => map.invalidateSize({ animate: false });
      requestAnimationFrame(resize);
      window.setTimeout(resize, 50);
      window.setTimeout(resize, 200);

      if (!disposed) setMapReady((value) => value + 1);
    }

    void initMap();

    return () => {
      disposed = true;
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
      markerRef.current = null;
      tileLayerRef.current = null;
      pathsLayerRef.current = null;
      locationsLayerRef.current = null;
      fittedRef.current = false;
      fittedPathKeyRef.current = "";
      setMapReady(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canShow]);

  // Theme tile swap without remount
  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = window.L;
    if (!map || !L || !mapReady) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    tileLayerRef.current = L.tileLayer(basemapTileUrl(theme), {
      attribution: basemapAttribution(),
      maxZoom: 20,
    }).addTo(map);
  }, [theme, mapReady]);

  // Draw / update path segments once the map exists
  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = window.L;
    const layer = pathsLayerRef.current;
    if (!map || !L || !layer || !mapReady) return;

    layer.clearLayers();

    const segments: FlightPathSegment[] =
      pathSegments && pathSegments.length > 0
        ? pathSegments
        : flightPath?.coordinates?.length
          ? [{ assetId: "all", coordinates: flightPath.coordinates }]
          : [];

    const allLatLngs: Array<[number, number]> = [];

    segments.forEach((segment, index) => {
      if (segment.coordinates.length < 2) return;
      const smoothed = prepareSmoothPath(segment.coordinates);
      const latLngs = smoothed.map(
        ([lng, lat]) => [lat, lng] as [number, number],
      );
      for (const point of latLngs) allLatLngs.push(point);

      const active = activeAssetId != null && segment.assetId === activeAssetId;
      const color = pathColorForIndex(index, theme);
      const line = L.polyline(latLngs, {
        color,
        weight: active ? 5 : 3.5,
        opacity: active ? 1 : 0.72,
        lineJoin: "round",
        lineCap: "round",
        smoothFactor: 2,
      });
      line.on("click", (event: { latlng: { lat: number; lng: number } }) => {
        onPathClickRef.current?.(event.latlng.lat, event.latlng.lng);
      });
      layer.addLayer(line);
    });

    for (const marker of locationMarkers ?? []) {
      allLatLngs.push([marker.lat, marker.lng]);
    }

    const pathKey = [
      segments
        .map(
          (segment) =>
            `${segment.assetId}:${segment.coordinates.length}:${segment.coordinates[0]?.join(",")}:${segment.coordinates.at(-1)?.join(",")}`,
        )
        .join("|"),
      (locationMarkers ?? [])
        .map((m) => `${m.id}:${m.lat.toFixed(5)},${m.lng.toFixed(5)}`)
        .join(";"),
    ].join("#");

    if (allLatLngs.length > 1) {
      if (fittedPathKeyRef.current !== pathKey) {
        map.fitBounds(L.latLngBounds(allLatLngs).pad(0.18), {
          animate: false,
        });
        fittedPathKeyRef.current = pathKey;
        fittedRef.current = true;
      }
    } else if (!fittedRef.current && allLatLngs.length === 1) {
      map.setView(allLatLngs[0], 15, { animate: false });
      fittedRef.current = true;
      fittedPathKeyRef.current = pathKey;
    }

    const resize = () => map.invalidateSize({ animate: false });
    requestAnimationFrame(resize);
    window.setTimeout(resize, 80);
    window.setTimeout(resize, 250);
  }, [
    pathSegments,
    flightPath,
    locationMarkers,
    activeAssetId,
    theme,
    mapReady,
  ]);

  // Static location pins for every geotagged asset in the flight
  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = window.L;
    const layer = locationsLayerRef.current;
    if (!map || !L || !layer || !mapReady) return;

    layer.clearLayers();
    for (const point of locationMarkers ?? []) {
      const active = activeAssetId != null && point.id === activeAssetId;
      const icon = L.divIcon({
        className: "dm-map-divicon",
        html: `<div style="opacity:${active ? 1 : 0.82};transform:scale(${active ? 1.12 : 1})">${
          point.kind === "photo" ? photoIconHtml() : droneIconHtml()
        }</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      const marker = L.marker([point.lat, point.lng], {
        icon,
        zIndexOffset: active ? 500 : 400,
      });
      marker.on("click", () => onMarkerClickRef.current?.(point.id));
      layer.addLayer(marker);
    }
  }, [locationMarkers, activeAssetId, mapReady]);

  // Live cursor for video playback (separate from static location pins)
  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = window.L;
    if (!map || !L || !mapReady) return;

    const position = currentPosition;
    const hideLiveCursor =
      !position ||
      (hasLocations &&
        markerKind === "photo" &&
        locationMarkers?.some(
          (m) =>
            m.id === activeAssetId &&
            Math.abs(m.lat - position.lat) < 1e-7 &&
            Math.abs(m.lng - position.lng) < 1e-7,
        ));

    if (!position || hideLiveCursor) {
      if (markerRef.current) {
        map.removeLayer(markerRef.current);
        markerRef.current = null;
      }
      return;
    }

    const latlng: [number, number] = [position.lat, position.lng];
    const icon = L.divIcon({
      className: "dm-map-divicon",
      html: markerKind === "photo" ? photoIconHtml() : droneIconHtml(),
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    if (!markerRef.current) {
      markerRef.current = L.marker(latlng, { icon, zIndexOffset: 600 }).addTo(
        map,
      );
    } else {
      markerRef.current.setLatLng(latlng);
      markerRef.current.setIcon(icon);
    }

    if (!fittedRef.current) {
      map.setView(latlng, 15, { animate: false });
      fittedRef.current = true;
    } else if (!hasPath && !hasLocations) {
      // Keep single-point photo/location maps centered on the marker.
      map.setView(latlng, map.getZoom() < 12 ? 15 : map.getZoom(), {
        animate: false,
      });
    }

    requestAnimationFrame(() => map.invalidateSize({ animate: false }));
  }, [
    currentPosition,
    markerKind,
    mapReady,
    hasPath,
    hasLocations,
    locationMarkers,
    activeAssetId,
  ]);

  if (!canShow) {
    return (
      <div
        className={
          className ??
          "flex h-40 items-center justify-center rounded-lg bg-muted/40 text-xs text-muted-foreground"
        }
      >
        No flight path available
      </div>
    );
  }

  return (
    <div
      ref={mapRef}
      className={className ?? "h-40 w-full overflow-hidden rounded-lg"}
      role="img"
      aria-label="Flight path map"
    />
  );
}
