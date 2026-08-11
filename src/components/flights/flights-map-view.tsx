"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Map as LeafletMap } from "leaflet";

import { useMapTheme } from "@/hooks/use-map-theme";
import type { FlightSummaryDto } from "@/lib/flights/queries";
import {
  AUTO_EXPAND_ZOOM,
  layoutColocatedPositions,
} from "@/lib/map/colocated-layout";
import {
  basemapAttribution,
  basemapTileUrl,
  readDocumentMapTheme,
} from "@/lib/map/tiles";
import { cn } from "@/lib/utils";

export type FlightsMapCamera = {
  lat: number;
  lng: number;
  zoom: number;
};

type MappedFlight = FlightSummaryDto & {
  location: { lat: number; lng: number };
};

async function loadLeafletWithCluster() {
  await import("leaflet");
  await import("leaflet/dist/leaflet.css");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const L = window.L as any;
  if (!L) throw new Error("Leaflet failed to initialize");

  await import("leaflet.markercluster");
  await import("leaflet.markercluster/dist/MarkerCluster.css");
  await import("leaflet.markercluster/dist/MarkerCluster.Default.css");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clustered = window.L as any;
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

function flightMarkerHtml(flight: MappedFlight) {
  const title = (flight.title ?? "Untitled flight")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
  const thumb = flight.coverAssetId
    ? `<img src="/api/assets/${flight.coverAssetId}/thumbnail" alt="" />`
    : `<span class="dm-flight-marker-fallback" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>
        </svg>
      </span>`;
  return `
    <div class="dm-map-marker-root" title="${title}">
      <div class="dm-map-marker">${thumb}</div>
    </div>
  `;
}

export function FlightsMapView({
  flights,
  className,
  initialCamera,
  onCameraChange,
  onOpenFlight,
}: {
  flights: FlightSummaryDto[];
  className?: string;
  initialCamera?: FlightsMapCamera | null;
  onCameraChange?: (camera: FlightsMapCamera) => void;
  onOpenFlight?: (flightId: string) => void;
}) {
  const router = useRouter();
  const theme = useMapTheme();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leafletRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clusterRef = useRef<any>(null);
  const tileLayerRef = useRef<import("leaflet").TileLayer | null>(null);
  const fittedRef = useRef(false);
  const markerLayoutKeyRef = useRef("");
  const flightsRef = useRef<MappedFlight[]>([]);
  const initialCameraRef = useRef(initialCamera);
  initialCameraRef.current = initialCamera;
  const onCameraChangeRef = useRef(onCameraChange);
  onCameraChangeRef.current = onCameraChange;
  const onOpenFlightRef = useRef(onOpenFlight);
  onOpenFlightRef.current = onOpenFlight;
  const routerRef = useRef(router);
  routerRef.current = router;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const mappedFlights = useMemo(
    () =>
      flights.filter(
        (flight): flight is MappedFlight => Boolean(flight.location),
      ),
    [flights],
  );
  flightsRef.current = mappedFlights;

  const flightIdsKey = useMemo(
    () => mappedFlights.map((flight) => flight.id).join(","),
    [mappedFlights],
  );

  function applyThemeTiles() {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;
    const nextTheme = readDocumentMapTheme();
    themeRef.current = nextTheme;
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    tileLayerRef.current = L.tileLayer(basemapTileUrl(nextTheme), {
      attribution: basemapAttribution(),
      maxZoom: 20,
    }).addTo(map);
  }

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;
    let disposed = false;

    function emitCamera() {
      const map = mapInstanceRef.current;
      if (!map) return;
      const center = map.getCenter();
      onCameraChangeRef.current?.({
        lat: center.lat,
        lng: center.lng,
        zoom: map.getZoom(),
      });
    }

    function syncMarkers(fitIfNeeded: boolean) {
      const map = mapInstanceRef.current;
      const L = leafletRef.current;
      const cluster = clusterRef.current;
      if (!map || !L || !cluster) return;

      const current = flightsRef.current;
      const zoom = map.getZoom();
      const expand = zoom >= AUTO_EXPAND_ZOOM;
      const assetKey = current.map((flight) => flight.id).join(",");
      const layoutKey = expand ? `e:${zoom}:${assetKey}` : `c:${assetKey}`;
      if (
        layoutKey === markerLayoutKeyRef.current &&
        cluster.getLayers().length === current.length
      ) {
        return;
      }
      markerLayoutKeyRef.current = layoutKey;

      const positions = layoutColocatedPositions(
        current.map((flight) => ({
          id: flight.id,
          lat: flight.location.lat,
          lng: flight.location.lng,
        })),
        {
          expand,
          project: (latLng) => map.latLngToLayerPoint(latLng),
          unproject: (point) =>
            map.layerPointToLatLng(L.point(point.x, point.y)),
        },
      );

      cluster.clearLayers();
      const bounds: Array<[number, number]> = [];
      for (const flight of current) {
        const position = positions.get(flight.id) ?? flight.location;
        const marker = L.marker([position.lat, position.lng], {
          icon: L.divIcon({
            html: flightMarkerHtml(flight),
            className: "dm-map-marker-wrap",
            iconSize: [48, 48],
            iconAnchor: [24, 24],
          }),
        });
        marker.on("click", () => {
          onOpenFlightRef.current?.(flight.id);
          routerRef.current.push(`/flights/${flight.id}`);
        });
        cluster.addLayer(marker);
        bounds.push([flight.location.lat, flight.location.lng]);
      }

      if (fitIfNeeded && !fittedRef.current && bounds.length > 0) {
        const saved = initialCameraRef.current;
        if (saved) {
          map.setView([saved.lat, saved.lng], saved.zoom, { animate: false });
        } else if (bounds.length === 1) {
          map.setView(bounds[0]!, 13, { animate: false });
        } else {
          map.fitBounds(L.latLngBounds(bounds).pad(0.2), { animate: false });
        }
        fittedRef.current = true;
        emitCamera();
      }
    }

    async function init() {
      const L = await loadLeafletWithCluster();
      if (disposed || !mapRef.current) return;

      leafletRef.current = L;
      const saved = initialCameraRef.current;
      const map = L.map(mapRef.current, {
        zoomControl: false,
        attributionControl: false,
        fadeAnimation: false,
      }).setView(
        saved ? [saved.lat, saved.lng] : [20, 0],
        saved?.zoom ?? 2,
      );

      mapInstanceRef.current = map;
      applyThemeTiles();

      const cluster = L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 48,
        spiderfyOnMaxZoom: false,
        disableClusteringAtZoom: AUTO_EXPAND_ZOOM,
      });
      cluster.addTo(map);
      clusterRef.current = cluster;

      if (saved) {
        fittedRef.current = true;
      }

      map.on("zoomend", () => {
        syncMarkers(false);
        emitCamera();
      });
      map.on("moveend", () => emitCamera());
      requestAnimationFrame(() => map.invalidateSize({ animate: false }));
      window.setTimeout(() => map.invalidateSize({ animate: false }), 80);
      // Apply theme again in case preferences hydrated after first paint.
      applyThemeTiles();
      syncMarkers(true);
    }

    void init();

    return () => {
      disposed = true;
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
      clusterRef.current = null;
      tileLayerRef.current = null;
      fittedRef.current = false;
      markerLayoutKeyRef.current = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    applyThemeTiles();
  }, [theme]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    const cluster = clusterRef.current;
    if (!map || !L || !cluster) return;

    markerLayoutKeyRef.current = "";
    const current = flightsRef.current;
    const zoom = map.getZoom();
    const expand = zoom >= AUTO_EXPAND_ZOOM;

    const positions = layoutColocatedPositions(
      current.map((flight) => ({
        id: flight.id,
        lat: flight.location.lat,
        lng: flight.location.lng,
      })),
      {
        expand,
        project: (latLng) => map.latLngToLayerPoint(latLng),
        unproject: (point) => map.layerPointToLatLng(L.point(point.x, point.y)),
      },
    );

    cluster.clearLayers();
    for (const flight of current) {
      const position = positions.get(flight.id) ?? flight.location;
      const marker = L.marker([position.lat, position.lng], {
        icon: L.divIcon({
          html: flightMarkerHtml(flight),
          className: "dm-map-marker-wrap",
          iconSize: [48, 48],
          iconAnchor: [24, 24],
        }),
      });
      marker.on("click", () => {
        onOpenFlightRef.current?.(flight.id);
        routerRef.current.push(`/flights/${flight.id}`);
      });
      cluster.addLayer(marker);
    }

    markerLayoutKeyRef.current = expand
      ? `e:${zoom}:${flightIdsKey}`
      : `c:${flightIdsKey}`;
  }, [flightIdsKey]);

  if (mappedFlights.length === 0) {
    return (
      <div
        className={cn(
          "flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center",
          className,
        )}
      >
        <p className="text-sm text-muted-foreground">
          No geotagged flights to show on the map.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border",
        className,
      )}
    >
      <div ref={mapRef} className="absolute inset-0 size-full" />
    </div>
  );
}
