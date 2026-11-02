"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { LatLngExpression, Map as LeafletMap } from "leaflet";

import { useMapTheme } from "@/hooks/use-map-theme";
import { useBasemap } from "@/hooks/use-basemap";
import { basemapUrlForTheme } from "@/lib/map/basemap";
import type { DashboardFlightPathDto } from "@/lib/dashboard/queries";
import { pathColorForIndex } from "@/lib/map/path-colors";
import { prepareSmoothPath } from "@/lib/map/path-smooth";
import { readDocumentMapTheme } from "@/lib/map/tiles";
import { cn } from "@/lib/utils";

async function loadLeaflet() {
  await import("leaflet");
  await import("leaflet/dist/leaflet.css");
  const L = window.L;
  if (!L) throw new Error("Leaflet failed to initialize");
  return L;
}

export function RecentFlightPathsMap({
  flights,
  className,
}: {
  flights: DashboardFlightPathDto[];
  className?: string;
}) {
  const router = useRouter();
  const theme = useMapTheme();
  const basemap = useBasemap();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const tileLayerRef = useRef<import("leaflet").TileLayer | null>(null);
  const pathsLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const routerRef = useRef(router);
  routerRef.current = router;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const flightsKey = flights.map((f) => f.flightId).join(",");

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;
    let disposed = false;

    void (async () => {
      const L = await loadLeaflet();
      if (disposed || !mapRef.current) return;

      const map = L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([51.5, -0.12], 6);

      tileLayerRef.current = L.tileLayer(
        basemapUrlForTheme(basemap, readDocumentMapTheme()),
        { attribution: basemap.attribution, maxZoom: 20 },
      ).addTo(map);

      pathsLayerRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;

      const onTheme = () => {
        const nextTheme = readDocumentMapTheme();
        themeRef.current = nextTheme;
        if (tileLayerRef.current) {
          map.removeLayer(tileLayerRef.current);
        }
        tileLayerRef.current = L.tileLayer(
          basemapUrlForTheme(basemap, nextTheme),
          { attribution: basemap.attribution, maxZoom: 20 },
        ).addTo(map);
      };
      window.addEventListener("dm-map-theme", onTheme);

      map.on("unload", () => {
        window.removeEventListener("dm-map-theme", onTheme);
      });
    })();

    return () => {
      disposed = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      pathsLayerRef.current = null;
      tileLayerRef.current = null;
    };
    // basemap config stable after first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const layer = pathsLayerRef.current;
    if (!map || !layer) return;

    void (async () => {
      const L = window.L;
      if (!L) return;

      layer.clearLayers();
      const bounds: Array<[number, number]> = [];
      const mapTheme = readDocumentMapTheme();

      flights.forEach((flight, index) => {
        const raw = flight.coordinates.map(
          ([lng, lat]) => [lng, lat] as [number, number],
        );
        const smoothed = prepareSmoothPath(raw);
        const drawLatLngs: LatLngExpression[] = smoothed.map(([lng, lat]) => [
          lat,
          lng,
        ]);
        if (drawLatLngs.length < 2) return;

        for (const point of smoothed) {
          bounds.push([point[1], point[0]]);
        }

        const color = pathColorForIndex(index, mapTheme);
        const line = L.polyline(drawLatLngs, {
          color,
          weight: 4,
          opacity: 0.85,
          lineJoin: "round",
          lineCap: "round",
          smoothFactor: 2,
        });
        const title = flight.title ?? "Flight";
        line.bindTooltip(title, { sticky: true, opacity: 0.92 });
        line.on("click", () => {
          routerRef.current.push(`/flights/${flight.flightId}`);
        });
        layer.addLayer(line);
      });

      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 });
      }
    })();
  }, [flightsKey, flights]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const frame = window.requestAnimationFrame(() => {
      map.invalidateSize({ animate: false });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [flights.length]);

  if (flights.length === 0) {
    return (
      <div
        className={cn(
          "flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center md:min-h-0 md:flex-1",
          className,
        )}
      >
        <p className="text-sm font-medium text-foreground">No recent flight paths</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          Import videos with telemetry or open{" "}
          <button
            type="button"
            className="text-primary underline-offset-2 hover:underline"
            onClick={() => router.push("/flights")}
          >
            Flights
          </button>{" "}
          to review sessions.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative min-h-[280px] overflow-hidden rounded-2xl border border-border md:min-h-0 md:flex-1",
        className,
      )}
    >
      <div ref={mapRef} className="absolute inset-0 size-full" />
    </div>
  );
}
