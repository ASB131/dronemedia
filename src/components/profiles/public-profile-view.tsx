"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  Globe2,
  ImageIcon,
  Map as MapIcon,
  UserRound,
} from "lucide-react";

import { AltitudeGraph } from "@/components/assets/altitude-graph";
import { FlightPathPreview } from "@/components/assets/flight-path-preview";
import { PreviewLutPicker } from "@/components/assets/preview-lut-picker";
import { useTelemetryCursor } from "@/components/assets/video-player";

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
import { Button } from "@/components/ui/button";
import {
  resolveViewerPreviewLutId,
  usePlaybackPreferences,
} from "@/hooks/use-playback-preferences";
import { useMapTheme } from "@/hooks/use-map-theme";
import {
  formatBitrateMBps,
  formatDimensions,
  formatDurationClock,
  formatExposureTime,
  formatFNumber,
  formatFrameRate,
} from "@/lib/assets/media-metadata";
import type {
  TelemetryGeoJson,
  TelemetrySeriesPoint,
} from "@/lib/assets/telemetry";
import { colorModeFromMediaMetadata } from "@/lib/luts/color-profile";
import { basemapTileUrl } from "@/lib/map/tiles";
import type { MapAssetDto } from "@/lib/map/queries";
import type { PublicFeaturedAlbumDto } from "@/lib/profiles/portfolio";
import type {
  PublicPortfolioAssetDto,
  PublicProfileDto,
} from "@/lib/profiles/queries";
import { cn } from "@/lib/utils";

type PublicProfilePayload = PublicProfileDto & {
  coverAssetId?: string | null;
  theme?: "default" | "cinematic" | "minimal";
};

function formatWhen(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(timestamp));
}

function formatBytes(bytes: number | null) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function thumbUrl(username: string, assetId: string) {
  return `/api/public/${encodeURIComponent(username)}/assets/${assetId}/thumbnail`;
}

function originalUrl(username: string, assetId: string) {
  return `/api/public/${encodeURIComponent(username)}/assets/${assetId}/original`;
}

function hlsUrl(username: string, assetId: string) {
  return `/api/public/${encodeURIComponent(username)}/assets/${assetId}/hls/index.m3u8`;
}

function downloadUrl(username: string, assetId: string) {
  return `/api/public/${encodeURIComponent(username)}/assets/${assetId}/download`;
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2 text-sm last:border-b-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-foreground">{children}</dd>
    </div>
  );
}

function MetaSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-xl border border-border/80 bg-muted/15">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3.5 py-3 text-left hover:bg-muted/40"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold tracking-tight">
            {title}
          </span>
          {summary && !open ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {summary}
            </span>
          ) : null}
        </span>
        <span className="text-xs text-muted-foreground">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className="border-t border-border/70 px-3.5 py-3">{children}</div>
      ) : null}
    </section>
  );
}

export function PublicProfileView({ username }: { username: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromCommunity = searchParams.get("from") === "community";
  const [profile, setProfile] = useState<PublicProfilePayload | null>(null);
  const [assets, setAssets] = useState<PublicPortfolioAssetDto[]>([]);
  const [showcase, setShowcase] = useState<PublicPortfolioAssetDto[]>([]);
  const [featuredAlbums, setFeaturedAlbums] = useState<PublicFeaturedAlbumDto[]>(
    [],
  );
  const [mapAssets, setMapAssets] = useState<MapAssetDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"portfolio" | "map">("portfolio");
  const [preview, setPreview] = useState<PublicPortfolioAssetDto | null>(null);
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  const [countryLabel, setCountryLabel] = useState<string | null>(null);
  const [previewTelemetry, setPreviewTelemetry] =
    useState<TelemetryGeoJson | null>(null);
  const [previewSeries, setPreviewSeries] = useState<TelemetrySeriesPoint[]>(
    [],
  );
  const [previewTime, setPreviewTime] = useState(0);
  const playbackPrefs = usePlaybackPreferences();
  const mapTheme = useMapTheme();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const previewCursor = useTelemetryCursor(previewSeries, previewTime);

  function syncAssetQuery(assetId: string | null, keepFrom = fromCommunity) {
    const params = new URLSearchParams();
    if (assetId) {
      params.set("asset", assetId);
      if (keepFrom) params.set("from", "community");
    }
    const qs = params.toString();
    router.replace(
      `/u/${encodeURIComponent(username)}${qs ? `?${qs}` : ""}`,
      { scroll: false },
    );
  }

  function openPreview(asset: PublicPortfolioAssetDto) {
    setPreview(asset);
    syncAssetQuery(asset.id);
  }

  function goToProfile() {
    setPreview(null);
    syncAssetQuery(null, false);
  }

  function closePreview() {
    if (fromCommunity) {
      router.push("/community?view=map");
      return;
    }
    goToProfile();
  }

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      const response = await fetch(
        `/api/public/${encodeURIComponent(username)}`,
      );
      if (!response.ok) {
        if (mounted) {
          setError("Profile not found");
          setLoading(false);
        }
        return;
      }
      const payload = (await response.json()) as {
        profile: PublicProfilePayload;
        assets: PublicPortfolioAssetDto[];
        mapAssets: MapAssetDto[];
        showcase?: PublicPortfolioAssetDto[];
        featuredAlbums?: PublicFeaturedAlbumDto[];
      };
      if (!mounted) return;
      setProfile(payload.profile);
      setAssets(payload.assets);
      setShowcase(payload.showcase ?? []);
      setFeaturedAlbums(payload.featuredAlbums ?? []);
      setMapAssets(payload.mapAssets);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [username]);

  useEffect(() => {
    const assetId = searchParams.get("asset");
    if (!assetId || assets.length === 0) return;
    const match = assets.find((asset) => asset.id === assetId) ?? null;
    if (!match) return;
    setPreview((current) => (current?.id === match.id ? current : match));
  }, [assets, searchParams]);

  useEffect(() => {
    if (!preview) {
      setPreviewTelemetry(null);
      setPreviewSeries([]);
      setPreviewTime(0);
      return;
    }
    setPreviewTime(0);
    if (preview.assetType === "photo") {
      setPreviewTelemetry(null);
      setPreviewSeries([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const response = await fetch(
        `/api/public/${encodeURIComponent(username)}/assets/${preview.id}/telemetry?series=1`,
      );
      if (!response.ok || cancelled) {
        if (!cancelled) {
          setPreviewTelemetry(null);
          setPreviewSeries([]);
        }
        return;
      }
      const payload = (await response.json()) as TelemetryGeoJson & {
        series?: TelemetrySeriesPoint[];
      };
      if (cancelled) return;
      setPreviewTelemetry({ flightPath: payload.flightPath });
      setPreviewSeries(payload.series ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [preview, username]);

  const photoCount = useMemo(
    () => assets.filter((asset) => asset.assetType === "photo").length,
    [assets],
  );
  const videoCount = useMemo(
    () => assets.filter((asset) => asset.assetType === "video").length,
    [assets],
  );

  const previewIndex = preview
    ? assets.findIndex((asset) => asset.id === preview.id)
    : -1;
  const previousAsset =
    previewIndex > 0 ? assets[previewIndex - 1] ?? null : null;
  const nextAsset =
    previewIndex >= 0 && previewIndex < assets.length - 1
      ? assets[previewIndex + 1] ?? null
      : null;

  useEffect(() => {
    if (!preview?.location) {
      setPlaceLabel(null);
      setCountryLabel(null);
      return;
    }
    let mounted = true;
    void (async () => {
      const response = await fetch(
        `/api/geo/reverse?lat=${preview.location!.lat}&lng=${preview.location!.lng}`,
      );
      if (!response.ok || !mounted) return;
      const payload = (await response.json()) as {
        place?: string | null;
        country?: string | null;
      };
      if (!mounted) return;
      setPlaceLabel(payload.place ?? null);
      setCountryLabel(payload.country ?? null);
    })();
    return () => {
      mounted = false;
    };
  }, [preview]);

  useEffect(() => {
    if (!preview) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowLeft" && previousAsset) {
        openPreview(previousAsset);
      }
      if (event.key === "ArrowRight" && nextAsset) {
        openPreview(nextAsset);
      }
      if (event.key === "Escape") {
        closePreview();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // openPreview/closePreview close over latest router/search state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, previousAsset, nextAsset, fromCommunity]);

  useEffect(() => {
    if (tab !== "map" || !mapRef.current || mapAssets.length === 0 || preview) {
      return;
    }
    let cancelled = false;

    void (async () => {
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
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
      L.tileLayer(basemapTileUrl(mapTheme), {
        maxZoom: 19,
      }).addTo(map);

      const bounds: Array<[number, number]> = [];
      for (const asset of mapAssets) {
        const marker = L.marker([asset.lat, asset.lng], {
          title: asset.displayName,
        });
        const iconHtml = `
          <div class="dm-map-marker-root" title="${asset.displayName.replace(/"/g, "&quot;")}">
            <div class="dm-map-marker">
              <img src="${thumbUrl(username, asset.id)}" alt="" />
            </div>
          </div>
        `;
        marker.setIcon(
          L.divIcon({
            className: "dm-map-marker-wrap",
            html: iconHtml,
            iconSize: [48, 48],
            iconAnchor: [24, 24],
          }),
        );
        marker.on("click", () => {
          const match = assets.find((row) => row.id === asset.id) ?? null;
          if (match) openPreview(match);
        });
        marker.addTo(map);
        bounds.push([asset.lat, asset.lng]);
      }

      if (bounds.length === 1) {
        map.setView(bounds[0]!, 13);
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
  }, [tab, mapAssets, mapTheme, username, assets, preview]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading profile…
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <UserRound className="size-8 text-muted-foreground/70" />
        <p className="text-sm font-medium">Profile not found</p>
      </div>
    );
  }

  if (preview) {
    const playbackReady =
      preview.assetType === "photo" ||
      preview.hasHls ||
      preview.hasProxy ||
      preview.hasLrf;
    const meta = preview.mediaMetadata;
    const previewColorMode = colorModeFromMediaMetadata(meta);
    const previewLutId = resolveViewerPreviewLutId(
      previewColorMode,
      playbackPrefs.previewLutId,
    );
    const cameraSummary =
      meta?.kind === "photo"
        ? [
            meta.cameraModel,
            formatDimensions(meta.width, meta.height),
          ]
            .filter(Boolean)
            .join(" · ")
        : meta?.kind === "video"
          ? [
              formatDurationClock(meta.durationSeconds),
              formatDimensions(meta.width, meta.height),
              meta.iso != null ? `ISO ${meta.iso}` : null,
              formatFNumber(meta.fNumber) !== "—"
                ? formatFNumber(meta.fNumber)
                : null,
              formatFrameRate(meta.frameRate),
            ]
              .filter(Boolean)
              .join(" · ")
          : undefined;

    const pathStart = previewTelemetry?.flightPath?.coordinates?.[0];
    const seriesStart = previewSeries[0];
    const mapPosition = previewCursor
      ? { lat: previewCursor.lat, lng: previewCursor.lng }
      : seriesStart
        ? { lat: seriesStart.lat, lng: seriesStart.lng }
        : pathStart
          ? { lat: pathStart[1], lng: pathStart[0] }
          : preview.location
            ? {
                lat: preview.location.lat,
                lng: preview.location.lng,
              }
            : null;
    const hasMap =
      Boolean(mapPosition) ||
      Boolean(previewTelemetry?.flightPath?.coordinates?.length);

    return (
      <div className="flex h-full flex-col bg-background">
        <div className="flex h-14 items-center gap-1 border-b border-border bg-background/95 px-3 backdrop-blur sm:gap-2 sm:px-4">
          <button
            type="button"
            aria-label={fromCommunity ? "Back to community map" : "Back"}
            onClick={closePreview}
            className="inline-flex size-10 items-center justify-center rounded-full hover:bg-muted"
          >
            <ArrowLeft className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold tracking-tight">
              {preview.displayName}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {formatWhen(preview.capturedAt)}
              {" · "}
              <button
                type="button"
                onClick={goToProfile}
                className="hover:underline"
              >
                @{profile.username}
              </button>
            </p>
          </div>
          <a
            href={downloadUrl(username, preview.id)}
            download
            aria-label="Download"
            title="Download"
            className="inline-flex size-10 items-center justify-center rounded-full bg-black/55 text-white shadow-md backdrop-blur-sm transition hover:bg-black/75"
          >
            <Download className="size-5" />
          </a>
        </div>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="group relative min-h-[50vh] bg-black lg:min-h-0">
            {preview.assetType === "photo" ? (
              <PhotoViewer
                src={originalUrl(username, preview.id)}
                sourceSrc={`${originalUrl(username, preview.id)}?playback=source`}
                alt={preview.displayName}
                lutId={previewLutId}
                className="absolute inset-0 size-full"
              />
            ) : playbackReady ? (
              <VideoPlayer
                key={preview.id}
                src={originalUrl(username, preview.id)}
                hlsSrc={preview.hasHls ? hlsUrl(username, preview.id) : null}
                sourceSrc={`${originalUrl(username, preview.id)}?playback=source`}
                defaultResolution={playbackPrefs.defaultPlaybackResolution}
                lutId={previewLutId}
                onTimeUpdate={(time) => setPreviewTime(time)}
                className="absolute inset-0 size-full object-contain"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                <Film className="size-8 text-white/70" />
                <p className="text-sm font-medium text-white/90">
                  Preparing playback…
                </p>
                <p className="max-w-sm text-xs text-white/60">
                  Download is still available for the original file.
                </p>
              </div>
            )}

            {previousAsset ? (
              <button
                type="button"
                aria-label="Previous media"
                title={previousAsset.displayName}
                onClick={() => openPreview(previousAsset)}
                className="absolute left-3 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white opacity-0 shadow-lg backdrop-blur transition group-hover:opacity-100 hover:bg-black/75 focus-visible:opacity-100"
              >
                <ChevronLeft className="size-6" />
              </button>
            ) : null}
            {nextAsset ? (
              <button
                type="button"
                aria-label="Next media"
                title={nextAsset.displayName}
                onClick={() => openPreview(nextAsset)}
                className="absolute right-3 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white opacity-0 shadow-lg backdrop-blur transition group-hover:opacity-100 hover:bg-black/75 focus-visible:opacity-100"
              >
                <ChevronRight className="size-6" />
              </button>
            ) : null}
          </section>

          <aside className="flex min-h-0 flex-col border-t border-border bg-background lg:border-l lg:border-t-0">
            <div className="min-h-0 flex-1 space-y-2.5 overflow-auto p-3 sm:p-4">
              {previewColorMode ? (
                <div className="rounded-xl border border-border px-3.5 py-3">
                  <PreviewLutPicker
                    colorProfile={previewColorMode}
                    value={playbackPrefs.previewLutId}
                    onChange={(next) =>
                      void playbackPrefs.setPreviewLutId(next)
                    }
                  />
                </div>
              ) : null}
              <div className="rounded-xl border border-border/80 bg-primary/5 px-3.5 py-3">
                <p className="text-sm font-semibold tracking-tight">
                  {preview.displayName}
                </p>
                <dl className="mt-2 space-y-1.5">
                  <InfoRow label="Date">{formatWhen(preview.capturedAt)}</InfoRow>
                  <InfoRow label="Type">
                    <span className="inline-flex items-center gap-1.5 capitalize">
                      {preview.assetType === "video" ? (
                        <Film className="size-3.5" />
                      ) : (
                        <ImageIcon className="size-3.5" />
                      )}
                      {preview.assetType}
                      {preview.mainFileExt
                        ? ` · ${preview.mainFileExt.toUpperCase()}`
                        : ""}
                    </span>
                  </InfoRow>
                  <InfoRow label="File size">
                    {formatBytes(preview.fileSizeBytes)}
                  </InfoRow>
                  <InfoRow label="Country">{countryLabel ?? "—"}</InfoRow>
                  <InfoRow label="Location">{placeLabel ?? "—"}</InfoRow>
                  {meta?.kind === "video" ? (
                    <InfoRow label="Length">
                      {formatDurationClock(meta.durationSeconds)}
                    </InfoRow>
                  ) : null}
                  {meta?.kind === "photo" &&
                  meta.altitudeMeters != null ? (
                    <InfoRow label="Altitude">
                      {Math.round(meta.altitudeMeters)} m
                    </InfoRow>
                  ) : null}
                </dl>
                {(preview.hasSrt || preview.hasLrf) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {preview.hasSrt ? (
                      <span className="rounded-md bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">
                        SRT
                      </span>
                    ) : null}
                    {preview.hasLrf ? (
                      <span className="rounded-md bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">
                        LRF
                      </span>
                    ) : null}
                  </div>
                )}
              </div>

              <MetaSection
                title="Camera details"
                summary={cameraSummary || "No camera metadata"}
              >
                {meta?.kind === "photo" ? (
                  <dl>
                    <InfoRow label="Dimensions">
                      {formatDimensions(meta.width, meta.height)}
                    </InfoRow>
                    <InfoRow label="Camera maker">
                      {meta.cameraMake ?? "—"}
                    </InfoRow>
                    <InfoRow label="Camera model">
                      {meta.cameraModel ?? "—"}
                    </InfoRow>
                    <InfoRow label="F-stop">
                      {formatFNumber(meta.fNumber)}
                    </InfoRow>
                    <InfoRow label="Exposure time">
                      {formatExposureTime(meta.exposureTimeSeconds)}
                    </InfoRow>
                    <InfoRow label="ISO speed">
                      {meta.iso != null ? String(meta.iso) : "—"}
                    </InfoRow>
                    <InfoRow label="Focal length">
                      {meta.focalLengthMm != null
                        ? `${Number(meta.focalLengthMm.toFixed(1))} mm`
                        : "—"}
                    </InfoRow>
                  </dl>
                ) : meta?.kind === "video" ? (
                  <dl>
                    <InfoRow label="Length">
                      {formatDurationClock(meta.durationSeconds)}
                    </InfoRow>
                    <InfoRow label="Dimensions">
                      {formatDimensions(meta.width, meta.height)}
                    </InfoRow>
                    <InfoRow label="Bitrate">
                      {formatBitrateMBps(meta.bitrateBps)}
                    </InfoRow>
                    <InfoRow label="Frame rate">
                      {formatFrameRate(meta.frameRate)}
                    </InfoRow>
                    <InfoRow label="ISO">
                      {meta.iso != null ? String(meta.iso) : "—"}
                    </InfoRow>
                    <InfoRow label="F-stop">
                      {formatFNumber(meta.fNumber)}
                    </InfoRow>
                    <InfoRow label="Shutter">
                      {formatExposureTime(meta.exposureTimeSeconds)}
                    </InfoRow>
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No camera metadata available.
                  </p>
                )}
              </MetaSection>

              {preview.description ? (
                <section className="rounded-xl border border-border/80 px-3.5 py-3">
                  <p className="text-sm font-semibold tracking-tight">
                    Description
                  </p>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {preview.description}
                  </p>
                </section>
              ) : null}
            </div>

            <div className="shrink-0 border-t border-border bg-background p-3 sm:p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold tracking-tight">Location</p>
                {placeLabel || countryLabel ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {[placeLabel, countryLabel].filter(Boolean).join(", ")}
                  </p>
                ) : null}
              </div>
              {hasMap ? (
                <>
                  <FlightPathPreview
                    flightPath={previewTelemetry?.flightPath ?? null}
                    currentPosition={mapPosition}
                    markerKind={
                      preview.assetType === "photo" ? "photo" : "drone"
                    }
                    className="aspect-square w-full overflow-hidden rounded-xl"
                  />
                  {preview.assetType !== "photo" && previewSeries.length > 1 ? (
                    <AltitudeGraph
                      series={previewSeries}
                      currentOffsetMs={Math.max(0, previewTime * 1000)}
                      className="mt-2"
                    />
                  ) : null}
                  {previewCursor?.speedMps != null ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Speed {(previewCursor.speedMps * 3.6).toFixed(1)} km/h
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No GPS location available for this asset.
                </p>
              )}
            </div>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-4 py-4">
        {profile.coverAssetId ? (
          <div
            className={cn(
              "relative mb-4 overflow-hidden",
              profile.theme === "minimal"
                ? "h-28 rounded-lg"
                : profile.theme === "cinematic"
                  ? "h-44 rounded-none"
                  : "h-36 rounded-2xl",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbUrl(username, profile.coverAssetId)}
              alt=""
              className="size-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
          </div>
        ) : null}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              <Globe2 className="size-3.5" />
              Public profile
            </p>
            <h1
              className={cn(
                "mt-1 tracking-tight",
                profile.theme === "cinematic"
                  ? "text-3xl font-semibold"
                  : "text-2xl font-semibold",
              )}
            >
              {profile.displayName}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              @{profile.username}
              {" · "}
              Member since {formatWhen(profile.memberSince)}
            </p>
            {profile.bio ? (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-foreground/90">
                {profile.bio}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <div className="rounded-xl border border-border bg-card px-3 py-2">
              <p className="text-[11px] text-muted-foreground">Public</p>
              <p className="text-lg font-semibold tabular-nums">
                {profile.publicAssetCount}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card px-3 py-2">
              <p className="text-[11px] text-muted-foreground">Photos</p>
              <p className="text-lg font-semibold tabular-nums">{photoCount}</p>
            </div>
            <div className="rounded-xl border border-border bg-card px-3 py-2">
              <p className="text-[11px] text-muted-foreground">Videos</p>
              <p className="text-lg font-semibold tabular-nums">{videoCount}</p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab("portfolio")}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-medium",
              tab === "portfolio"
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            <ImageIcon className="size-3.5" />
            Portfolio
          </button>
          <button
            type="button"
            onClick={() => setTab("map")}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-medium",
              tab === "map"
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            <MapIcon className="size-3.5" />
            Map ({mapAssets.length})
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {tab === "portfolio" ? (
          assets.length === 0 &&
          showcase.length === 0 &&
          featuredAlbums.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
              <Globe2 className="size-8 text-muted-foreground/70" />
              <p className="text-sm font-medium">No public media yet</p>
              <p className="text-xs text-muted-foreground">
                This flyer hasn&apos;t published any photos or videos.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {showcase.length > 0 ? (
                <section className="space-y-2">
                  <h2 className="text-sm font-semibold">Showcase</h2>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {showcase.map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => openPreview(asset)}
                        className="relative aspect-[16/9] overflow-hidden rounded-xl bg-muted"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={thumbUrl(username, asset.id)}
                          alt=""
                          className="size-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
              {featuredAlbums.length > 0 ? (
                <section className="space-y-2">
                  <h2 className="text-sm font-semibold">Featured albums</h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {featuredAlbums.map((album) => (
                      <div
                        key={album.id}
                        className="overflow-hidden rounded-xl border border-border"
                      >
                        <div className="relative aspect-[16/9] bg-muted">
                          {album.coverAssetId ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={thumbUrl(username, album.coverAssetId)}
                              alt=""
                              className="size-full object-cover"
                            />
                          ) : null}
                        </div>
                        <div className="p-3">
                          <p className="text-sm font-semibold">{album.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {album.publicAssetCount} public
                            {album.description
                              ? ` · ${album.description}`
                              : ""}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {assets.map((asset) => (
                  <div
                    key={asset.id}
                    className="overflow-hidden rounded-xl border border-border bg-card"
                  >
                    <button
                      type="button"
                      onClick={() => openPreview(asset)}
                      className="group relative block aspect-[16/9] w-full bg-muted text-left"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbUrl(username, asset.id)}
                        alt=""
                        className="size-full object-cover transition duration-300 group-hover:scale-[1.03]"
                        loading="lazy"
                      />
                      <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
                        {asset.assetType === "video" ? (
                          <Film className="size-3" />
                        ) : (
                          <ImageIcon className="size-3" />
                        )}
                        {asset.mainFileExt.toUpperCase()}
                      </span>
                    </button>
                    <div className="space-y-2 p-2.5">
                      <div>
                        <p className="truncate text-sm font-medium">
                          {asset.displayName}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatWhen(asset.capturedAt)}
                        </p>
                      </div>
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          onClick={() => openPreview(asset)}
                        >
                          Open
                        </Button>
                        <a
                          href={downloadUrl(username, asset.id)}
                          download
                          aria-label="Download"
                          title="Download"
                          className="inline-flex size-8 items-center justify-center rounded-full bg-black/55 text-white shadow-md backdrop-blur-sm transition hover:bg-black/75"
                        >
                          <Download className="size-4" />
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        ) : mapAssets.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <MapIcon className="size-8 text-muted-foreground/70" />
            <p className="text-sm font-medium">No geotagged public media</p>
          </div>
        ) : (
          <div
            ref={mapRef}
            className="h-full min-h-[22rem] overflow-hidden rounded-2xl border border-border"
          />
        )}
      </div>
    </div>
  );
}
