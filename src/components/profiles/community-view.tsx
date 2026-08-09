"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import { LayoutGrid, Map as MapIcon, Users } from "lucide-react";

import { useMapTheme } from "@/hooks/use-map-theme";
import {
  AUTO_EXPAND_ZOOM,
  layoutColocatedPositions,
} from "@/lib/map/colocated-layout";
import { basemapTileUrl } from "@/lib/map/tiles";
import type {
  CommunityMapAssetDto,
  CommunityUserDto,
} from "@/lib/profiles/queries";
import { cn } from "@/lib/utils";

type ViewMode = "profiles" | "map";

function thumbUrl(username: string, assetId: string) {
  return `/api/public/${encodeURIComponent(username)}/assets/${assetId}/thumbnail`;
}

async function loadLeafletWithCluster() {
  await import("leaflet");
  await import("leaflet/dist/leaflet.css");

  // leaflet.markercluster patches the browser global window.L rather than the
  // ESM namespace returned by import("leaflet").
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

function thumbnailMarkerHtml(asset: CommunityMapAssetDto) {
  const title = asset.displayName
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
  const photoBadge =
    asset.assetType === "photo"
      ? `<span class="dm-map-marker-badge dm-map-marker-badge-photo" title="Photo" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
        </span>`
      : "";
  return `
    <div class="dm-map-marker-root" title="${title}">
      <div class="dm-map-marker">
        <img src="${thumbUrl(asset.username, asset.id)}" alt="" />
      </div>
      ${photoBadge}
    </div>
  `;
}

export function CommunityView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialView =
    searchParams.get("view") === "map" ? "map" : "profiles";
  const [view, setView] = useState<ViewMode>(initialView);
  const [users, setUsers] = useState<CommunityUserDto[]>([]);
  const [mapAssets, setMapAssets] = useState<CommunityMapAssetDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mapTheme = useMapTheme();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    const next = searchParams.get("view") === "map" ? "map" : "profiles";
    setView(next);
  }, [searchParams]);

  function switchView(next: ViewMode) {
    setView(next);
    const url =
      next === "map" ? "/community?view=map" : "/community";
    router.replace(url, { scroll: false });
  }

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      if (view === "map") {
        const response = await fetch("/api/community?view=map");
        if (!response.ok) {
          setError("Failed to load community map");
          setLoading(false);
          return;
        }
        const payload = (await response.json()) as {
          mapAssets: CommunityMapAssetDto[];
        };
        setMapAssets(payload.mapAssets);
      } else {
        const response = await fetch("/api/community?view=profiles");
        if (!response.ok) {
          setError("Failed to load community");
          setLoading(false);
          return;
        }
        const payload = (await response.json()) as { users: CommunityUserDto[] };
        setUsers(payload.users);
      }
      setLoading(false);
    })();
  }, [view]);

  useEffect(() => {
    if (view !== "map" || !mapRef.current || mapAssets.length === 0) {
      return;
    }
    let cancelled = false;

    void (async () => {
      let L: Awaited<ReturnType<typeof loadLeafletWithCluster>>;
      try {
        L = await loadLeafletWithCluster();
      } catch {
        if (!cancelled) setError("Map clustering failed to load");
        return;
      }
      if (cancelled || !mapRef.current) return;

      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      const map = L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: false,
      });
      mapInstanceRef.current = map;
      L.tileLayer(basemapTileUrl(mapTheme), { maxZoom: 19 }).addTo(map);

      const bounds: Array<[number, number]> = [];
      const clusterGroup = L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 64,
        spiderfyOnMaxZoom: true,
        zoomToBoundsOnClick: true,
        disableClusteringAtZoom: AUTO_EXPAND_ZOOM,
        spiderfyDistanceMultiplier: 2.4,
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

      const placeMarkers = () => {
        const expand = map.getZoom() >= AUTO_EXPAND_ZOOM;
        const positions = layoutColocatedPositions(mapAssets, {
          expand,
          project: (latLng) => map.latLngToLayerPoint(latLng),
          unproject: (point) =>
            map.layerPointToLatLng(L.point(point.x, point.y)),
        });
        clusterGroup.clearLayers();
        for (const asset of mapAssets) {
          const position = positions.get(asset.id) ?? {
            lat: asset.lat,
            lng: asset.lng,
          };
          const marker = L.marker([position.lat, position.lng], {
            title: `${asset.ownerDisplayName}: ${asset.displayName}`,
            icon: L.divIcon({
              className: "dm-map-marker-wrap",
              html: thumbnailMarkerHtml(asset),
              iconSize: [48, 48],
              iconAnchor: [24, 24],
            }),
          });
          marker.on("click", () => {
            router.push(
              `/u/${encodeURIComponent(asset.username)}?asset=${encodeURIComponent(asset.id)}&from=community`,
            );
          });
          clusterGroup.addLayer(marker);
        }
      };

      for (const asset of mapAssets) {
        bounds.push([asset.lat, asset.lng]);
      }
      placeMarkers();
      map.addLayer(clusterGroup);
      map.on("zoomend", placeMarkers);

      if (bounds.length === 1) {
        map.setView(bounds[0]!, 12);
      } else if (bounds.length > 1) {
        map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40] });
      }
    })();

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [view, mapAssets, mapTheme, router]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-4 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Community</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {view === "map"
                ? "Public photos and videos with GPS"
                : "Browse public flyer profiles and shared locations"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => switchView("profiles")}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-medium",
                view === "profiles"
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              <LayoutGrid className="size-3.5" />
              Profiles
            </button>
            <button
              type="button"
              onClick={() => switchView("map")}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-medium",
                view === "map"
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              <MapIcon className="size-3.5" />
              Map
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading community…</p>
        ) : error ? (
          <p className="p-4 text-sm text-destructive">{error}</p>
        ) : view === "profiles" ? (
          <div className="h-full overflow-auto p-4">
            {users.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
                <Users className="size-8 text-muted-foreground/70" />
                <p className="text-sm font-medium">No public portfolios yet</p>
                <p className="max-w-md text-xs text-muted-foreground">
                  Mark photos or videos as Public from the timeline or asset page
                  to appear here.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {users.map((user) => (
                  <Link
                    key={user.username}
                    href={`/u/${encodeURIComponent(user.username)}`}
                    className="group flex flex-col items-center gap-2 rounded-xl p-3 text-center transition hover:bg-muted/50"
                    title={`@${user.username}`}
                  >
                    <span className="relative size-16 overflow-hidden rounded-full border border-border bg-muted shadow-sm sm:size-20">
                      {user.coverAssetId ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumbUrl(user.username, user.coverAssetId)}
                          alt=""
                          className="size-full object-cover transition group-hover:scale-105"
                        />
                      ) : (
                        <span className="flex size-full items-center justify-center text-lg font-semibold text-muted-foreground">
                          {(user.displayName || user.username)
                            .slice(0, 1)
                            .toUpperCase()}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 w-full space-y-0.5">
                      <span className="block truncate text-sm font-semibold">
                        {user.displayName}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        @{user.username}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {user.publicAssetCount} public
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ) : mapAssets.length === 0 ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 p-8 text-center">
            <MapIcon className="size-8 text-muted-foreground/70" />
            <p className="text-sm font-medium">No geotagged public media</p>
            <p className="max-w-md text-xs text-muted-foreground">
              Public photos and videos with GPS will show up on this map.
            </p>
          </div>
        ) : (
          <div ref={mapRef} className="size-full" />
        )}
      </div>
    </div>
  );
}
