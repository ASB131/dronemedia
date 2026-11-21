"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Map as LeafletMap } from "leaflet";

import { useBasemap } from "@/hooks/use-basemap";
import { useMapTheme } from "@/hooks/use-map-theme";
import {
  AUTO_EXPAND_ZOOM,
  layoutColocatedPositions,
} from "@/lib/map/colocated-layout";
import type { MapAssetDto } from "@/lib/map/queries";
import { thumbnailMarkerHtml as buildThumbnailMarkerHtml } from "@/lib/map/marker-html";
import { basemapUrlForTheme } from "@/lib/map/basemap";
import { readDocumentMapTheme } from "@/lib/map/tiles";
import { cn } from "@/lib/utils";

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

export function TripMapView({
  tripId,
  className,
}: {
  tripId: string;
  className?: string;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  useMapTheme();
  const basemap = useBasemap();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;
    let map: LeafletMap | null = null;

    void (async () => {
      const response = await fetch(`/api/trips/${tripId}/map`);
      if (!response.ok || cancelled) return;
      const payload = (await response.json()) as { assets: MapAssetDto[] };
      const assets = payload.assets.filter(
        (a) => Number.isFinite(a.lat) && Number.isFinite(a.lng),
      );
      if (assets.length === 0 || cancelled) return;

      const L = await loadLeafletWithCluster();
      if (cancelled || !containerRef.current) return;

      const tileUrl = basemapUrlForTheme(basemap, readDocumentMapTheme());

      const mapInstance = L.map(el, {
        zoomControl: true,
        attributionControl: true,
      });
      map = mapInstance;
      mapRef.current = mapInstance;

      L.tileLayer(tileUrl, {
        maxZoom: basemap.maxZoom,
        attribution: basemap.attribution,
      }).addTo(mapInstance);

      const cluster = L.markerClusterGroup({
        maxClusterRadius: 56,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
      });

      const zoom = mapInstance.getZoom();
      const expand = zoom >= AUTO_EXPAND_ZOOM;
      const positions = layoutColocatedPositions(
        assets.map((a) => ({ id: a.id, lat: a.lat, lng: a.lng })),
        {
          expand,
          project: (latLng) => mapInstance.latLngToLayerPoint(latLng),
          unproject: (point) =>
            mapInstance.layerPointToLatLng(L.point(point.x, point.y)),
        },
      );

      const bounds: Array<[number, number]> = [];
      for (const asset of assets) {
        const position = positions.get(asset.id) ?? {
          lat: asset.lat,
          lng: asset.lng,
        };
        const html = buildThumbnailMarkerHtml(
          asset,
          `/api/assets/${asset.id}/thumbnail`,
        );
        const marker = L.marker([position.lat, position.lng], {
          icon: L.divIcon({
            className: "dm-map-marker-wrap",
            html,
            iconSize: [48, 48],
            iconAnchor: [24, 24],
          }),
        });
        marker.on("click", () => {
          router.push(`/assets/${asset.id}`);
        });
        cluster.addLayer(marker);
        bounds.push([asset.lat, asset.lng]);
      }

      mapInstance.addLayer(cluster);
      if (bounds.length === 1) {
        mapInstance.setView(bounds[0]!, 13);
      } else if (bounds.length > 1) {
        mapInstance.fitBounds(L.latLngBounds(bounds).pad(0.12), {
          maxZoom: AUTO_EXPAND_ZOOM,
        });
      }
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [tripId, basemap, router]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      mapRef.current?.invalidateSize({ animate: false });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn("min-h-[220px] w-full rounded-xl bg-muted", className)}
      aria-label="Trip map"
    />
  );
}