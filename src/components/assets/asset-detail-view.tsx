"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Album,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Film,
  Globe2,
  Heart,
  ImageIcon,
  Images,
  Trash2,
  X,
} from "lucide-react";

import { AddToFlightModal } from "@/components/assets/add-to-flight-modal";
import { AssetDownloadButton } from "@/components/assets/asset-download-button";
import { FlightPathPreview } from "@/components/assets/flight-path-preview";
import { AltitudeGraph } from "@/components/assets/altitude-graph";
import { MissingTelemetryCallout } from "@/components/assets/missing-telemetry-callout";
import {
  PhotoClipContextCard,
  type PhotoClipContextView,
} from "@/components/assets/photo-clip-context-card";
import { PreviewLutPicker } from "@/components/assets/preview-lut-picker";
import { useTelemetryCursor } from "@/components/assets/video-player";
import { distanceMeters } from "@/lib/map/colocated-layout";

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
const PanoramaViewer = dynamic(
  () =>
    import("@/components/assets/panorama-viewer").then((m) => m.PanoramaViewer),
  { ssr: false },
);
const SetLocationModal = dynamic(
  () =>
    import("@/components/assets/set-location-modal").then(
      (m) => m.SetLocationModal,
    ),
  { ssr: false },
);
import { usePlaybackPreferences } from "@/hooks/use-playback-preferences";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DetailChromeSkeleton } from "@/components/ui/skeletons";
import type { AlbumSummaryDto } from "@/lib/albums/queries";
import type {
  AssetDetailDto,
  AssetNeighborsDto,
} from "@/lib/assets/detail";
import {
  SEQUENCE_FPS_PRESETS,
  clampSequenceFps,
  formatSequenceDuration,
} from "@/lib/assets/sequence-fps";
import type { VideoChapterDto } from "@/lib/assets/exports";
import type { FlightSummaryDto } from "@/lib/flights/queries";
import { colorModeFromMediaMetadata } from "@/lib/luts/color-profile";
import {
  formatBitrateMBps,
  formatDimensions,
  formatDurationClock,
  formatExposureTime,
  formatFNumber,
  formatFrameRate,
  type PanoramaViewerMode,
} from "@/lib/assets/media-metadata";
import {
  effectivePanoramaViewer,
  isEquirectViewerMode,
} from "@/lib/assets/panorama-viewer-mode";
import { effectivePanoramaPoseHeading } from "@/lib/assets/panorama-heading";
import { PANORAMA_WEB_CACHE_VERSION } from "@/lib/assets/panorama-web-version";
import { getMediaReturnPath } from "@/lib/navigation/media-return";
import { assetThumbnailSrc } from "@/lib/assets/thumbnail-url";
import type {
  TelemetryGeoJson,
  TelemetrySeriesPoint,
} from "@/lib/assets/telemetry";
import { cn } from "@/lib/utils";

function prefetchAsset(id: string) {
  void fetch(`/api/assets/${id}`).catch(() => undefined);
  const img = new Image();
  img.src = assetThumbnailSrc(id);
}

function runWhenIdle(task: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const ric = (
    window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    }
  ).requestIdleCallback;
  if (typeof ric === "function") {
    const handle = ric(task, { timeout: 1200 });
    return () => {
      (
        window as Window & { cancelIdleCallback?: (handle: number) => void }
      ).cancelIdleCallback?.(handle);
    };
  }
  const handle = window.setTimeout(task, 200);
  return () => window.clearTimeout(handle);
}

function ViewerModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
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

function formatDuration(seconds: number | null) {
  if (!seconds) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
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

export function AssetDetailView({ assetId }: { assetId: string }) {
  const router = useRouter();
  const [asset, setAsset] = useState<AssetDetailDto | null>(null);
  const [jobGates, setJobGates] = useState<{
    webTranscoding: boolean;
    panoramaStitch: boolean;
  } | null>(null);
  const [neighbors, setNeighbors] = useState<AssetNeighborsDto | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryGeoJson | null>(null);
  const [series, setSeries] = useState<TelemetrySeriesPoint[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [chapters, setChapters] = useState<VideoChapterDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [albumMenuOpen, setAlbumMenuOpen] = useState(false);
  const albumMenuRef = useRef<HTMLDivElement>(null);
  const sideListsLoadedRef = useRef(false);
  const [albums, setAlbums] = useState<AlbumSummaryDto[]>([]);
  const [albumMessage, setAlbumMessage] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [capturedAt, setCapturedAt] = useState("");
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  const [countryLabel, setCountryLabel] = useState<string | null>(null);
  const [dronesList, setDronesList] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [droneId, setDroneId] = useState("");
  const [flightsList, setFlightsList] = useState<FlightSummaryDto[]>([]);
  const [flightModalOpen, setFlightModalOpen] = useState(false);
  const [flightSaving, setFlightSaving] = useState(false);
  const [sequenceFpsDraft, setSequenceFpsDraft] = useState("24");
  const [fpsSaving, setFpsSaving] = useState(false);
  const [preferredLutId, setPreferredLutId] = useState("");
  const [selectedTileIndex, setSelectedTileIndex] = useState<number | null>(
    null,
  );
  const [clipContext, setClipContext] = useState<PhotoClipContextView | null>(
    null,
  );
  const [seekRequest, setSeekRequest] = useState<{
    timeSeconds: number;
    token: number;
  } | null>(null);
  const [lookHeadingDegrees, setLookHeadingDegrees] = useState<number | null>(
    null,
  );
  const panoYawDegreesRef = useRef<(() => number | null) | null>(null);
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [locationSaving, setLocationSaving] = useState(false);
  const [directionCalibrating, setDirectionCalibrating] = useState(false);
  const [allowInAppSource, setAllowInAppSource] = useState(true);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [refreshOpts, setRefreshOpts] = useState({
    thumbnails: true,
    metadata: true,
    dedup: true,
    webTranscoding: false,
    panoramaStitch: false,
  });
  const playbackPrefs = usePlaybackPreferences();

  useEffect(() => {
    setLookHeadingDegrees(null);
    setDirectionCalibrating(false);
    setLocationModalOpen(false);
  }, [assetId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("t");
    if (raw == null) return;
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds < 0) return;
    setSeekRequest({ timeSeconds: seconds, token: Date.now() });
  }, [assetId]);

  async function ensureSideLists() {
    if (sideListsLoadedRef.current) return;
    const [albumsRes, dronesRes, flightsRes] = await Promise.all([
      fetch("/api/albums"),
      fetch("/api/drones"),
      fetch("/api/flights"),
    ]);
    if (albumsRes.ok) {
      const payload = (await albumsRes.json()) as {
        albums: AlbumSummaryDto[];
      };
      setAlbums(payload.albums);
    }
    if (dronesRes.ok) {
      const payload = (await dronesRes.json()) as {
        drones: Array<{ id: string; name: string }>;
      };
      setDronesList(payload.drones.map((d) => ({ id: d.id, name: d.name })));
    }
    if (flightsRes.ok) {
      const payload = (await flightsRes.json()) as {
        flights: FlightSummaryDto[];
      };
      setFlightsList(payload.flights);
    }
    sideListsLoadedRef.current = true;
  }

  async function loadAssetData(id: string) {
    const [detailRes, telemetryRes, chaptersRes, neighborsRes] =
      await Promise.all([
        fetch(`/api/assets/${id}`),
        fetch(`/api/assets/${id}/telemetry?series=1`),
        fetch(`/api/assets/${id}/export?format=chapters`),
        fetch(`/api/assets/${id}/neighbors`),
      ]);

    if (!detailRes.ok) {
      setError(
        detailRes.status === 404 ? "Asset not found" : "Failed to load asset",
      );
      setAsset(null);
      return;
    }

    const detailPayload = (await detailRes.json()) as {
      asset: AssetDetailDto;
      allowInAppSource?: boolean;
    };
    setAsset(detailPayload.asset);
    setAllowInAppSource(detailPayload.allowInAppSource !== false);
    setDisplayName(detailPayload.asset.displayName);
    setDescription(detailPayload.asset.description ?? "");
    setTags(detailPayload.asset.tags ?? []);
    setCapturedAt(detailPayload.asset.capturedAt.slice(0, 16));
    setDroneId(detailPayload.asset.droneId ?? "");
    setSequenceFpsDraft(String(detailPayload.asset.sequenceFps ?? 24));
    setPreferredLutId(detailPayload.asset.preferredLutId ?? "");
    setPlaceLabel(null);
    setCountryLabel(null);
    setCurrentTime(0);
    setSelectedTileIndex(null);
    setAlbumMessage(null);
    setEditMessage(null);
    setClipContext(null);
    if (detailPayload.asset.location) {
      const geoRes = await fetch(
        `/api/geo/reverse?lat=${detailPayload.asset.location.lat}&lng=${detailPayload.asset.location.lng}`,
      );
      if (geoRes.ok) {
        const geo = (await geoRes.json()) as {
          label?: string | null;
          place?: string | null;
          country?: string | null;
        };
        setPlaceLabel(geo.place ?? geo.label ?? null);
        setCountryLabel(geo.country ?? null);
      }
    }

    if (neighborsRes.ok) {
      setNeighbors((await neighborsRes.json()) as AssetNeighborsDto);
    } else {
      setNeighbors(null);
    }

    if (telemetryRes.ok) {
      const payload = (await telemetryRes.json()) as TelemetryGeoJson & {
        series?: TelemetrySeriesPoint[];
      };
      setTelemetry({
        flightPath: payload.flightPath,
        homePoint: payload.homePoint ?? null,
      });
      setSeries(payload.series ?? []);
    } else {
      setTelemetry(null);
      setSeries([]);
    }
    if (chaptersRes.ok) {
      const payload = (await chaptersRes.json()) as {
        chapters: VideoChapterDto[];
      };
      setChapters(payload.chapters);
    } else {
      setChapters([]);
    }

    const still =
      detailPayload.asset.assetType === "photo" ||
      detailPayload.asset.sequenceKind === "panorama";
    if (still && detailPayload.asset.flightId) {
      const clipRes = await fetch(`/api/assets/${id}/clip-context`);
      if (clipRes.ok) {
        const payload = (await clipRes.json()) as {
          context: PhotoClipContextView | null;
        };
        setClipContext(payload.context);
      }
    }
  }

  async function load(id = assetId) {
    setError(null);
    const isSwitch = asset != null && asset.id !== id;
    if (isSwitch) {
      setSwitching(true);
    }

    try {
      await Promise.all([loadAssetData(id), ensureSideLists()]);
    } finally {
      setSwitching(false);
    }
  }

  useEffect(() => {
    void load(assetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when browsing a new asset
  }, [assetId]);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/jobs/gates");
      if (!response.ok) return;
      const payload = (await response.json()) as {
        gates: { webTranscoding: boolean; panoramaStitch: boolean };
      };
      setJobGates(payload.gates);
    })();
  }, []);

  useEffect(() => {
    if (!neighbors) return;
    return runWhenIdle(() => {
      if (neighbors.previous) prefetchAsset(neighbors.previous.id);
      if (neighbors.next) prefetchAsset(neighbors.next.id);
    });
  }, [neighbors]);

  useEffect(() => {
    if (!asset || (asset.assetType !== "video" && asset.assetType !== "sequence")) {
      return;
    }
    const isPanorama = asset.sequenceKind === "panorama";
    if (isPanorama) {
      if (asset.hasPanoPreview) return;
      if (jobGates && !jobGates.panoramaStitch) return;
      // Tiles without a large pano image will never get a sphere preview.
      if ((asset.sequenceFrames?.length ?? 0) > 0) return;
    } else if (asset.hasHls || asset.hasProxy) {
      return;
    } else if (jobGates && !jobGates.webTranscoding) {
      return;
    }

    const timer = window.setInterval(() => {
      void (async () => {
        const response = await fetch(`/api/assets/${assetId}`);
        if (!response.ok) return;
        const payload = (await response.json()) as { asset: AssetDetailDto };
        setAsset(payload.asset);
      })();
    }, 4000);

    return () => window.clearInterval(timer);
  }, [asset, assetId, jobGates]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (event.key === "ArrowLeft" && neighbors?.next) {
        router.replace(`/assets/${neighbors.next.id}`);
      }
      if (event.key === "ArrowRight" && neighbors?.previous) {
        router.replace(`/assets/${neighbors.previous.id}`);
      }
      if (event.key === "Escape") {
        setAlbumMenuOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [neighbors, router]);

  useEffect(() => {
    if (!albumMenuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!albumMenuRef.current?.contains(event.target as Node)) {
        setAlbumMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [albumMenuOpen]);

  async function addToAlbum(albumId: string) {
    setAlbumMessage(null);
    const response = await fetch(`/api/albums/${albumId}/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId }),
    });
    if (!response.ok) {
      setAlbumMessage("Failed to add to album");
      return;
    }
    setAlbumMessage("Added to album");
    setAlbumMenuOpen(false);
  }

  async function moveToBin() {
    if (!confirm("Move this asset to the bin?")) return;
    setDeleting(true);
    const response = await fetch(`/api/assets/${assetId}`, {
      method: "DELETE",
    });
    setDeleting(false);
    if (!response.ok) {
      setError("Failed to move asset to bin");
      return;
    }
    router.push("/");
  }

  async function patch(body: Record<string, unknown>) {
    setEditMessage(null);
    const response = await fetch(`/api/assets/${assetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      setEditMessage("Update failed");
      return;
    }
    const payload = (await response.json()) as { asset: AssetDetailDto };
    setAsset(payload.asset);
    setDescription(payload.asset.description ?? "");
    setTags(payload.asset.tags ?? []);
    setDroneId(payload.asset.droneId ?? "");
    setDisplayName(payload.asset.displayName);
    setSequenceFpsDraft(String(payload.asset.sequenceFps ?? 24));
    setPreferredLutId(payload.asset.preferredLutId ?? "");
    if (payload.asset.location) {
      const geoRes = await fetch(
        `/api/geo/reverse?lat=${payload.asset.location.lat}&lng=${payload.asset.location.lng}`,
      );
      if (geoRes.ok) {
        const geo = (await geoRes.json()) as {
          label?: string | null;
          place?: string | null;
          country?: string | null;
        };
        setPlaceLabel(geo.place ?? geo.label ?? null);
        setCountryLabel(geo.country ?? null);
      }
    } else {
      setPlaceLabel(null);
      setCountryLabel(null);
    }
    setEditMessage("Saved");
  }

  async function saveFlightLink(nextFlightId: string | null) {
    setEditMessage(null);
    setFlightSaving(true);
    try {
      const response = await fetch("/api/flights/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reassign",
          assetId,
          flightId: nextFlightId,
        }),
      });
      if (!response.ok) {
        setEditMessage("Flight update failed");
        return;
      }
      setFlightModalOpen(false);
      await load();
      setEditMessage(
        nextFlightId ? "Added to flight" : "Removed from flight",
      );
    } finally {
      setFlightSaving(false);
    }
  }

  function addTag() {
    const next = tagDraft.trim();
    if (!next) return;
    if (tags.some((tag) => tag.toLowerCase() === next.toLowerCase())) {
      setTagDraft("");
      return;
    }
    if (tags.length >= 50) {
      setEditMessage("Maximum 50 tags");
      return;
    }
    setTags((prev) => [...prev, next]);
    setTagDraft("");
  }

  const cursor = useTelemetryCursor(series, currentTime);
  const homeDistanceMeters = useMemo(() => {
    if (!cursor || !telemetry?.homePoint) return null;
    return distanceMeters(
      { lat: cursor.lat, lng: cursor.lng },
      telemetry.homePoint,
    );
  }, [cursor, telemetry?.homePoint]);

  function formatHomeDistance(meters: number) {
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
    return `${Math.round(meters)} m`;
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-destructive">{error}</p>
        <Link
          href="/"
          className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm hover:bg-muted"
        >
          Back to timeline
        </Link>
      </div>
    );
  }

  if (!asset) {
    return <DetailChromeSkeleton />;
  }

  const isPanorama = asset.sequenceKind === "panorama";
  const viewerMode = effectivePanoramaViewer(asset);
  // Tile browser for sequence panos and photos set to 180/360 — not flat photos
  // that only happen to carry sphere/size metadata.
  const showTilesSection =
    isPanorama || isEquirectViewerMode(viewerMode);
  const canToggleViewer =
    asset.assetType === "photo" ||
    (asset.assetType === "sequence" && isPanorama);
  const equirectReady =
    isEquirectViewerMode(viewerMode) &&
    (asset.assetType === "photo" || asset.hasPanoPreview);
  const playbackReady = isEquirectViewerMode(viewerMode)
    ? equirectReady || asset.assetType === "photo"
    : asset.assetType === "photo" ||
      asset.hasHls ||
      asset.hasProxy ||
      (isPanorama && asset.hasPanoPreview);
  /** Videos: Source only after a streaming derivative exists. Photos: always allow Source when gated on. */
  const allowVideoSourcePlayback = asset.hasHls || asset.hasProxy;
  const mediaUrl = `/api/assets/${asset.id}/original`;
  const photoSourceUrl =
    allowInAppSource &&
    (asset.assetType === "photo" || isPanorama)
      ? `/api/assets/${asset.id}/original?playback=source`
      : null;
  const videoSourceUrl =
    allowInAppSource && allowVideoSourcePlayback
      ? `/api/assets/${asset.id}/original?playback=source`
      : null;
  const panoUrl = `/api/assets/${asset.id}/pano?v=${PANORAMA_WEB_CACHE_VERSION}`;
  const hlsUrl = asset.hasHls
    ? `/api/assets/${asset.id}/hls/index.m3u8`
    : null;
  const colorMode = colorModeFromMediaMetadata(asset.mediaMetadata);
  /** Only the asset's preferred LUT — never auto-apply account preview LUT. */
  const effectiveLutId = colorMode
    ? preferredLutId || asset.preferredLutId || null
    : null;
  const scrubberMarkers = chapters.filter((chapter) =>
    /max altitude/i.test(chapter.label),
  );
  const hasMap =
    Boolean(telemetry?.flightPath?.coordinates.length) ||
    Boolean(asset.location);

  const droneFlightSummary = [
    asset.droneName,
    asset.flightTitle,
    asset.telemetry?.totalDistanceMeters != null
      ? `${(asset.telemetry.totalDistanceMeters / 1000).toFixed(1)} km`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const cameraSummary =
    asset.mediaMetadata?.kind === "photo"
      ? [
          asset.mediaMetadata.cameraModel,
          formatDimensions(
            asset.mediaMetadata.width,
            asset.mediaMetadata.height,
          ),
          (isPanorama || isEquirectViewerMode(viewerMode)) &&
          asset.mediaMetadata.panoramaWidth &&
          asset.mediaMetadata.panoramaHeight
            ? `Pano ${formatDimensions(
                asset.mediaMetadata.panoramaWidth,
                asset.mediaMetadata.panoramaHeight,
              )}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : asset.mediaMetadata?.kind === "video"
        ? [
            formatDurationClock(asset.mediaMetadata.durationSeconds),
            formatDimensions(
              asset.mediaMetadata.width,
              asset.mediaMetadata.height,
            ),
            asset.mediaMetadata.iso != null
              ? `ISO ${asset.mediaMetadata.iso}`
              : null,
            formatFNumber(asset.mediaMetadata.fNumber) !== "—"
              ? formatFNumber(asset.mediaMetadata.fNumber)
              : null,
            formatFrameRate(asset.mediaMetadata.frameRate),
          ]
            .filter(Boolean)
            .join(" · ")
        : undefined;

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="relative z-30 flex h-14 items-center gap-1 border-b border-border bg-background/95 px-3 backdrop-blur sm:gap-2 sm:px-4">
        <button
          type="button"
          aria-label="Back"
          title="Back"
          onClick={() => {
            // Neighbor browsing uses router.replace, so history's previous
            // entry is the originating list (timeline/favorites/etc.), not
            // another asset. Fall back when this tab was opened cold.
            if (typeof window !== "undefined" && window.history.length > 1) {
              router.back();
              return;
            }
            router.replace(getMediaReturnPath() ?? "/");
          }}
          className="inline-flex size-10 items-center justify-center rounded-full hover:bg-muted"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold tracking-tight">
            {asset.displayName}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {asset.capturedLabel}
          </p>
        </div>
        <AssetDownloadButton
          assetId={assetId}
          assetType={asset.assetType}
          sequenceKind={asset.sequenceKind}
          hasSrt={asset.hasSrt}
          hasLrf={asset.hasLrf}
          hasProxy={asset.hasProxy}
          hasFullResExport={asset.hasFullResExport}
          hasPanoPreview={asset.hasPanoPreview}
        />
        <button
          type="button"
          aria-label={asset.favorite ? "Unfavorite" : "Favorite"}
          className="inline-flex size-10 items-center justify-center rounded-full hover:bg-muted"
          onClick={() => void patch({ favorite: !asset.favorite })}
        >
          <Heart
            className={`size-5 ${asset.favorite ? "fill-primary text-primary" : ""}`}
          />
        </button>
        <button
          type="button"
          aria-label={asset.isPublic ? "Make private" : "Make public"}
          title={
            asset.isPublic
              ? "Visible on your public profile"
              : "Show on your public profile"
          }
          className="inline-flex size-10 items-center justify-center rounded-full hover:bg-muted"
          onClick={() => void patch({ isPublic: !asset.isPublic })}
        >
          <Globe2
            className={`size-5 ${asset.isPublic ? "text-sky-500" : "text-muted-foreground"}`}
          />
        </button>
        <div ref={albumMenuRef} className="relative">
          <button
            type="button"
            aria-label="Add to album"
            title={albumMessage ?? "Add to album"}
            className="inline-flex size-10 items-center justify-center rounded-full hover:bg-muted"
            onClick={() => setAlbumMenuOpen((open) => !open)}
          >
            <Album className="size-5" />
          </button>
          {albumMenuOpen ? (
            <div className="absolute right-0 top-11 z-40 w-56 overflow-hidden rounded-xl border border-border bg-popover p-1.5 shadow-lg">
              {albums.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  No albums yet.{" "}
                  <Link
                    href="/albums"
                    className="text-primary hover:underline"
                    onClick={() => setAlbumMenuOpen(false)}
                  >
                    Create one
                  </Link>
                </div>
              ) : (
                albums.map((album) => (
                  <button
                    key={album.id}
                    type="button"
                    className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => void addToAlbum(album.id)}
                  >
                    {album.name}
                  </button>
                ))
              )}
              {albumMessage ? (
                <p className="px-3 py-1.5 text-xs text-muted-foreground">
                  {albumMessage}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Move to bin"
          title="Move to bin"
          disabled={deleting}
          className="inline-flex size-10 items-center justify-center rounded-full hover:bg-muted disabled:opacity-50"
          onClick={() => void moveToBin()}
        >
          <Trash2 className="size-5" />
        </button>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="group relative min-h-[50vh] bg-black lg:min-h-0">
          {switching || asset.id !== assetId ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70">
              <p className="text-sm text-white/80">Loading…</p>
            </div>
          ) : null}
          {viewerMode === "photo" && asset.assetType === "photo" ? (
            <PhotoViewer
              key={`${asset.id}-photo`}
              src={mediaUrl}
              sourceSrc={photoSourceUrl}
              alt={asset.displayName}
              lutId={effectiveLutId}
              className="absolute inset-0 size-full"
            />
          ) : viewerMode === "180" &&
            (asset.assetType === "photo" || isPanorama) &&
            playbackReady ? (
            <PhotoViewer
              key={`${asset.id}-180`}
              src={panoUrl}
              sourceSrc={photoSourceUrl}
              alt={asset.displayName}
              lutId={effectiveLutId}
              className="absolute inset-0 size-full"
            />
          ) : viewerMode === "360" &&
            (asset.assetType === "photo" || isPanorama) &&
            playbackReady ? (
            <PanoramaViewer
              key={`${asset.id}-360`}
              src={panoUrl}
              poseHeadingDegrees={
                asset.mediaMetadata?.kind === "photo"
                  ? effectivePanoramaPoseHeading(asset.mediaMetadata)
                  : null
              }
              onLookHeadingChange={setLookHeadingDegrees}
              yawDegreesRef={panoYawDegreesRef}
              className="absolute inset-0 size-full"
            />
          ) : viewerMode === "photo" && isPanorama && playbackReady ? (
            <PhotoViewer
              key={`${asset.id}-pano-flat`}
              src={panoUrl}
              sourceSrc={photoSourceUrl}
              alt={asset.displayName}
              lutId={effectiveLutId}
              className="absolute inset-0 size-full"
            />
          ) : !isPanorama &&
            asset.assetType !== "photo" &&
            playbackReady ? (
            <VideoPlayer
              src={mediaUrl}
              hlsSrc={
                playbackPrefs.previewQualitiesDisabled ? null : hlsUrl
              }
              sourceSrc={videoSourceUrl}
              defaultResolution={
                playbackPrefs.previewQualitiesDisabled && allowInAppSource
                  ? "source"
                  : allowInAppSource
                    ? playbackPrefs.defaultPlaybackResolution
                    : playbackPrefs.defaultPlaybackResolution === "source"
                      ? ((playbackPrefs.enabledPreviewHeights[
                          playbackPrefs.enabledPreviewHeights.length - 1
                        ]?.toString() ?? "1080") as
                          | "720"
                          | "1080"
                          | "1440")
                      : playbackPrefs.defaultPlaybackResolution
              }
              enabledHeights={playbackPrefs.enabledPreviewHeights}
              previewQualitiesDisabled={
                playbackPrefs.previewQualitiesDisabled && !allowInAppSource
              }
              lutId={effectiveLutId}
              scrubberMarkers={scrubberMarkers}
              seekRequest={seekRequest}
              onTimeUpdate={(time) => setCurrentTime(time)}
              className="absolute inset-0 size-full object-contain"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm font-medium text-white/90">
                {isPanorama
                  ? (asset.sequenceFrames?.length ?? 0) > 0
                    ? "Panorama image missing"
                    : jobGates && !jobGates.panoramaStitch
                      ? "Panorama preview unavailable"
                      : "Preparing panorama…"
                  : jobGates && !jobGates.webTranscoding
                    ? "Streaming preview unavailable"
                    : "Preparing playback…"}
              </p>
              <p className="max-w-sm text-xs text-white/60">
                {isPanorama
                  ? (asset.sequenceFrames?.length ?? 0) > 0
                    ? "This panorama has source tiles but no large stitched pano image. Open tiles from the sidebar to view them individually."
                    : jobGates && !jobGates.panoramaStitch
                      ? "An administrator has paused panorama processing. A preview will appear after processing is enabled and a pano image is available."
                      : "Waiting for the large panorama image preview. This page will refresh automatically when ready."
                  : jobGates && !jobGates.webTranscoding
                    ? "An administrator has paused transcoding (or a preview has not been generated yet). Source playback in the player is disabled until a streaming preview exists — you can still download the original file."
                    : "A streaming preview is being generated. This page will refresh automatically when ready. Source quality is available in the player after the preview exists."}
              </p>
            </div>
          )}

          {directionCalibrating ? (
            <div className="absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
              <div className="flex max-w-lg flex-col gap-2 rounded-xl border border-white/15 bg-black/75 px-4 py-3 text-white shadow-lg backdrop-blur">
                <p className="text-sm font-medium">Point this view north</p>
                <p className="text-xs text-white/70">
                  Pan the panorama until you are looking due north, then click
                  Done.
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-white/20 bg-white/10 text-white hover:bg-white/20"
                    onClick={() => setDirectionCalibrating(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      const yaw = panoYawDegreesRef.current?.() ?? null;
                      if (yaw == null) {
                        setEditMessage(
                          "Open the 360 panorama, then try Reset direction again",
                        );
                        return;
                      }
                      setDirectionCalibrating(false);
                      void patch({ panoramaHeadingOverride: yaw });
                    }}
                  >
                    Done
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {neighbors?.next ? (
            <button
              type="button"
              aria-label="Later media"
              title={neighbors.next.displayName}
              onClick={() => router.replace(`/assets/${neighbors.next!.id}`)}
              className="absolute left-3 top-1/2 z-20 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white opacity-0 shadow-lg backdrop-blur transition group-hover:opacity-100 hover:bg-black/75 focus-visible:opacity-100"
            >
              <ChevronLeft className="size-6" />
            </button>
          ) : null}
          {neighbors?.previous ? (
            <button
              type="button"
              aria-label="Earlier media"
              title={neighbors.previous.displayName}
              onClick={() =>
                router.replace(`/assets/${neighbors.previous!.id}`)
              }
              className="absolute right-3 top-1/2 z-20 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white opacity-0 shadow-lg backdrop-blur transition group-hover:opacity-100 hover:bg-black/75 focus-visible:opacity-100"
            >
              <ChevronRight className="size-6" />
            </button>
          ) : null}
        </section>

        <aside className="flex min-h-0 flex-col border-t border-border bg-background lg:border-l lg:border-t-0">
          <div className="min-h-0 flex-1 space-y-2.5 overflow-auto p-3 sm:p-4">
            <div className="rounded-xl border border-border/80 bg-primary/5 px-3.5 py-3">
              <p className="text-sm font-semibold tracking-tight">
                {asset.displayName}
              </p>
              <dl className="mt-2 space-y-1.5">
                <InfoRow label="Date">{asset.capturedLabel}</InfoRow>
                <InfoRow label="Type">
                  <span className="inline-flex items-center gap-1.5 capitalize">
                    {asset.assetType === "video" ? (
                      <Film className="size-3.5" />
                    ) : asset.assetType === "sequence" ? (
                      <Images className="size-3.5" />
                    ) : (
                      <ImageIcon className="size-3.5" />
                    )}
                    {asset.assetType === "sequence"
                      ? asset.sequenceKind === "panorama"
                        ? "panorama"
                        : asset.sequenceKind === "hyperlapse"
                          ? "hyperlapse"
                          : "sequence"
                      : asset.assetType}
                    {asset.assetType === "sequence" && asset.frameCount
                      ? ` · ${asset.frameCount} ${isPanorama ? "tiles" : "frames"}`
                      : asset.mainFileExt && asset.assetType !== "sequence"
                        ? ` · ${asset.mainFileExt.toUpperCase()}`
                        : ""}
                  </span>
                </InfoRow>
                {asset.assetType === "sequence" && asset.sequenceFolder ? (
                  <InfoRow label="Folder">{asset.sequenceFolder}</InfoRow>
                ) : null}
                <InfoRow label="File size">
                  {formatBytes(asset.fileSizeBytes)}
                </InfoRow>
                <InfoRow label="Country">{countryLabel ?? "—"}</InfoRow>
                <InfoRow label="Location">{placeLabel ?? "—"}</InfoRow>
                {asset.assetType === "video" &&
                asset.mediaMetadata?.kind === "video" ? (
                  <InfoRow label="Length">
                    {formatDurationClock(asset.mediaMetadata.durationSeconds)}
                  </InfoRow>
                ) : null}
              </dl>
              {(asset.hasSrt || asset.hasLrf) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {asset.hasSrt ? (
                    <span className="rounded-md bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">
                      SRT
                    </span>
                  ) : null}
                  {asset.hasLrf ? (
                    <span className="rounded-md bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">
                      LRF
                    </span>
                  ) : null}
                </div>
              )}
            </div>

            {clipContext ? <PhotoClipContextCard context={clipContext} /> : null}

            <MissingTelemetryCallout
              kind={
                isPanorama || asset.assetType === "photo"
                  ? "photo"
                  : asset.assetType === "video"
                    ? "video"
                    : "sequence"
              }
              hasSrt={asset.hasSrt}
              parseStatus={asset.telemetry?.parseStatus ?? null}
              hasLocation={Boolean(asset.location)}
              hasFlightPath={Boolean(asset.telemetry?.hasFlightPath)}
              hasSeries={series.length > 1}
            />

            {asset.assetType === "sequence" && !isPanorama ? (
              <MetaSection
                title="Frame rate"
                summary={`${asset.sequenceFps ?? 24} fps · ${asset.frameCount ?? 0} frames`}
                defaultOpen
              >
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Controls in-app playback and the full-resolution MP4 download.
                    Changing it rebuilds the preview video.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {SEQUENCE_FPS_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setSequenceFpsDraft(String(preset))}
                        className={`rounded-md px-2.5 py-1 text-xs tabular-nums transition ${
                          Number(sequenceFpsDraft) === preset
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor="sequence-fps">
                      Custom frame rate
                    </label>
                    <input
                      id="sequence-fps"
                      type="number"
                      min={1}
                      max={120}
                      step={1}
                      value={sequenceFpsDraft}
                      onChange={(event) =>
                        setSequenceFpsDraft(event.target.value)
                      }
                      className="h-8 w-24 rounded-lg border border-border bg-background px-2 text-sm tabular-nums"
                    />
                    <span className="text-xs text-muted-foreground">fps</span>
                    <Button
                      type="button"
                      size="sm"
                      disabled={
                        fpsSaving ||
                        !Number.isFinite(Number(sequenceFpsDraft)) ||
                        clampSequenceFps(Number(sequenceFpsDraft)) ===
                          (asset.sequenceFps ?? 24)
                      }
                      onClick={() => {
                        const next = clampSequenceFps(Number(sequenceFpsDraft));
                        setSequenceFpsDraft(String(next));
                        setFpsSaving(true);
                        void patch({ sequenceFps: next }).finally(() =>
                          setFpsSaving(false),
                        );
                      }}
                    >
                      {fpsSaving ? "Saving…" : "Apply"}
                    </Button>
                  </div>
                  {formatSequenceDuration(
                    asset.frameCount,
                    Number(sequenceFpsDraft) || asset.sequenceFps,
                  ) ? (
                    <p className="text-xs text-muted-foreground">
                      Estimated length:{" "}
                      {formatSequenceDuration(
                        asset.frameCount,
                        Number(sequenceFpsDraft) || asset.sequenceFps,
                      )}
                    </p>
                  ) : null}
                </div>
              </MetaSection>
            ) : null}

            <MetaSection
              title="Camera details"
              summary={
                canToggleViewer
                  ? `${cameraSummary || "No camera metadata"} · view as ${viewerMode === "photo" ? "Photo" : viewerMode === "180" ? "180°" : "360°"}`
                  : cameraSummary || "No camera metadata"
              }
            >
              {canToggleViewer ? (
                <div className="mb-3 space-y-2 border-b border-border/60 pb-3">
                  <p className="text-xs font-medium text-foreground">
                    View as
                  </p>
                  <div className="flex rounded-lg bg-muted p-0.5">
                    <ViewerModeButton
                      active={viewerMode === "photo"}
                      label="Photo"
                      onClick={() =>
                        void patch({ panoramaViewer: "photo" satisfies PanoramaViewerMode })
                      }
                    />
                    <ViewerModeButton
                      active={isEquirectViewerMode(viewerMode)}
                      label="Panorama"
                      onClick={() =>
                        void patch({
                          panoramaViewer:
                            viewerMode === "photo" ? "360" : viewerMode,
                        })
                      }
                    />
                  </div>
                  {isEquirectViewerMode(viewerMode) ? (
                    <>
                      <p className="text-xs text-muted-foreground">Projection</p>
                      <div className="flex rounded-lg bg-muted p-0.5">
                        <ViewerModeButton
                          active={viewerMode === "180"}
                          label="180°"
                          onClick={() =>
                            void patch({ panoramaViewer: "180" })
                          }
                        />
                        <ViewerModeButton
                          active={viewerMode === "360"}
                          label="360°"
                          onClick={() =>
                            void patch({ panoramaViewer: "360" })
                          }
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
              {asset.mediaMetadata?.kind === "photo" ? (
                <dl>
                  <InfoRow label="Dimensions">
                    {formatDimensions(
                      asset.mediaMetadata.width,
                      asset.mediaMetadata.height,
                    )}
                  </InfoRow>
                  {isPanorama || isEquirectViewerMode(viewerMode) ? (
                    <InfoRow label="Panorama resolution">
                      {formatDimensions(
                        asset.mediaMetadata.panoramaWidth,
                        asset.mediaMetadata.panoramaHeight,
                      )}
                    </InfoRow>
                  ) : null}
                  <InfoRow label="Camera maker">
                    {asset.mediaMetadata.cameraMake ?? "—"}
                  </InfoRow>
                  <InfoRow label="Camera model">
                    {asset.mediaMetadata.cameraModel ?? "—"}
                  </InfoRow>
                  <InfoRow label="F-stop">
                    {formatFNumber(asset.mediaMetadata.fNumber)}
                  </InfoRow>
                  <InfoRow label="Exposure time">
                    {formatExposureTime(
                      asset.mediaMetadata.exposureTimeSeconds,
                    )}
                  </InfoRow>
                  <InfoRow label="ISO speed">
                    {asset.mediaMetadata.iso != null
                      ? String(asset.mediaMetadata.iso)
                      : "—"}
                  </InfoRow>
                  <InfoRow label="Focal length">
                    {asset.mediaMetadata.focalLengthMm != null
                      ? `${Number(asset.mediaMetadata.focalLengthMm.toFixed(1))} mm`
                      : "—"}
                  </InfoRow>
                  <InfoRow label="Altitude">
                    {asset.mediaMetadata.altitudeMeters != null
                      ? `${Number(asset.mediaMetadata.altitudeMeters.toFixed(1))} m`
                      : "—"}
                  </InfoRow>
                </dl>
              ) : asset.mediaMetadata?.kind === "video" ? (
                <dl>
                  <InfoRow label="Length">
                    {formatDurationClock(asset.mediaMetadata.durationSeconds)}
                  </InfoRow>
                  <InfoRow label="Dimensions">
                    {formatDimensions(
                      asset.mediaMetadata.width,
                      asset.mediaMetadata.height,
                    )}
                  </InfoRow>
                  <InfoRow label="Bitrate">
                    {formatBitrateMBps(asset.mediaMetadata.bitrateBps)}
                  </InfoRow>
                  <InfoRow label="Frame rate">
                    {formatFrameRate(asset.mediaMetadata.frameRate)}
                  </InfoRow>
                  <InfoRow label="F-stop">
                    {formatFNumber(asset.mediaMetadata.fNumber)}
                  </InfoRow>
                  <InfoRow label="Exposure time">
                    {formatExposureTime(
                      asset.mediaMetadata.exposureTimeSeconds ?? null,
                    )}
                  </InfoRow>
                  <InfoRow label="ISO speed">
                    {asset.mediaMetadata.iso != null
                      ? String(asset.mediaMetadata.iso)
                      : "—"}
                  </InfoRow>
                  <InfoRow label="Exposure bias">
                    {asset.mediaMetadata.exposureBias != null
                      ? `${asset.mediaMetadata.exposureBias} EV`
                      : "—"}
                  </InfoRow>
                  <InfoRow label="Color temperature">
                    {asset.mediaMetadata.colorTemperatureK != null
                      ? `${Math.round(asset.mediaMetadata.colorTemperatureK)} K`
                      : "—"}
                  </InfoRow>
                  <InfoRow label="Color mode">
                    {asset.mediaMetadata.colorMode ?? "—"}
                  </InfoRow>
                  <InfoRow label="Focal length">
                    {asset.mediaMetadata.focalLengthMm != null
                      ? `${Number(asset.mediaMetadata.focalLengthMm.toFixed(1))} mm`
                      : "—"}
                  </InfoRow>
                  <InfoRow label="Timezone">{asset.capturedTimezone}</InfoRow>
                </dl>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No camera or video metadata extracted yet.
                </p>
              )}

              {asset.assetType === "video" ? (
                <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
                  {colorMode ? (
                    <PreviewLutPicker
                      colorProfile={colorMode}
                      value={effectiveLutId}
                      onChange={(next) => {
                        setPreferredLutId(next ?? "");
                        void patch({ preferredLutId: next });
                      }}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      LUT grading is available for D-Log / D-Log M videos once
                      color mode is detected from the SRT.
                    </p>
                  )}
                </div>
              ) : null}
            </MetaSection>

            {showTilesSection ? (
              <MetaSection
                title="View tiles"
                summary={
                  asset.sequenceFrames.length > 0
                    ? `${asset.sequenceFrames.length} tiles`
                    : "Tiles not found"
                }
              >
                {asset.sequenceFrames.length === 0 ? (
                  <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border bg-background/50 px-3 py-4">
                    <Images className="size-6 text-muted-foreground/70" />
                    <p className="text-sm font-medium">Tiles not found</p>
                    <p className="text-xs text-muted-foreground">
                      Upload a PANORAMA folder with the original tiles to view
                      them here.
                    </p>
                    <Link
                      href="/upload"
                      className="text-xs text-primary hover:underline"
                    >
                      Go to upload
                    </Link>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    {[...asset.sequenceFrames]
                      .sort((a, b) => a.frameIndex - b.frameIndex)
                      .map((frame) => (
                        <button
                          key={frame.id}
                          type="button"
                          title={frame.filename}
                          className="group relative aspect-square overflow-hidden rounded-md bg-muted"
                          onClick={() => setSelectedTileIndex(frame.frameIndex)}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/assets/${asset.id}/frames/${frame.frameIndex}?thumb=1`}
                            alt={frame.filename}
                            className="size-full object-cover transition group-hover:brightness-90"
                            loading="lazy"
                          />
                          <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1 pb-0.5 pt-3 text-[10px] text-white">
                            {frame.frameIndex + 1}
                          </span>
                        </button>
                      ))}
                  </div>
                )}
              </MetaSection>
            ) : null}

            <MetaSection
              title="Drone & flight"
              summary={droneFlightSummary || "Not linked"}
            >
              <div className="space-y-3">
                <label className="block text-xs text-muted-foreground">
                  Linked drone
                  <select
                    value={droneId}
                    onChange={(event) => setDroneId(event.target.value)}
                    className="mt-1 block w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
                  >
                    <option value="">No drone</option>
                    {dronesList.map((drone) => (
                      <option key={drone.id} value={drone.id}>
                        {drone.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void patch({ droneId: droneId ? droneId : null })
                    }
                  >
                    Save drone
                  </Button>
                  {dronesList.length === 0 ? (
                    <Link
                      href="/drones"
                      className="inline-flex h-8 items-center text-xs text-primary hover:underline"
                    >
                      Register a drone
                    </Link>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Flight</p>
                  {asset.flightId ? (
                    <p className="text-sm">
                      <Link
                        href={`/flights/${asset.flightId}`}
                        className="text-primary hover:underline"
                      >
                        {asset.flightTitle ?? "Open flight"}
                      </Link>
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Not linked to a flight yet
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={flightSaving}
                      onClick={() => setFlightModalOpen(true)}
                    >
                      {asset.flightId ? "Change flight" : "Add to flight"}
                    </Button>
                    {asset.flightId ? (
                      <Link
                        href={`/flights/${asset.flightId}`}
                        className="inline-flex h-8 items-center text-xs text-primary hover:underline"
                      >
                        Open flight
                      </Link>
                    ) : null}
                  </div>
                </div>
                {asset.telemetry ? (
                  <dl className="rounded-lg border border-border/70 bg-background/60 px-2.5">
                    <InfoRow label="Status">
                      <span className="capitalize">
                        {asset.telemetry.parseStatus}
                      </span>
                    </InfoRow>
                    <InfoRow label="Max altitude">
                      {asset.telemetry.maxAltitudeMeters != null
                        ? `${Math.round(asset.telemetry.maxAltitudeMeters)} m`
                        : "—"}
                    </InfoRow>
                    <InfoRow label="Distance">
                      {asset.telemetry.totalDistanceMeters != null
                        ? `${(asset.telemetry.totalDistanceMeters / 1000).toFixed(2)} km`
                        : "—"}
                    </InfoRow>
                    <InfoRow label="Flight duration">
                      {formatDuration(asset.telemetry.flightDurationSeconds)}
                    </InfoRow>
                  </dl>
                ) : null}
                {asset.telemetry ? (
                  <div className="flex flex-wrap gap-3">
                    <a
                      className="text-xs text-primary hover:underline"
                      href={`/api/assets/${assetId}/export?format=gpx`}
                    >
                      GPX
                    </a>
                    <a
                      className="text-xs text-primary hover:underline"
                      href={`/api/assets/${assetId}/export?format=kml`}
                    >
                      KML
                    </a>
                    <a
                      className="text-xs text-primary hover:underline"
                      href={`/api/assets/${assetId}/export?format=csv`}
                    >
                      CSV
                    </a>
                  </div>
                ) : null}
              </div>
            </MetaSection>

            <MetaSection
              title="Edit"
              summary={
                [
                  displayName.trim() || null,
                  description.trim() ? "Description" : null,
                  tags.length > 0
                    ? `${tags.length} tag${tags.length === 1 ? "" : "s"}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Name, time, description, tags"
              }
            >
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    className="text-sm"
                    placeholder="Display name"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void patch({ displayName })}
                  >
                    Rename
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Input
                    type="datetime-local"
                    value={capturedAt}
                    onChange={(event) => setCapturedAt(event.target.value)}
                    className="text-sm"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void patch({
                        capturedAtOverride: new Date(capturedAt).toISOString(),
                      })
                    }
                  >
                    Set time
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setLocationModalOpen(true)}
                >
                  {asset.location ? "Change location" : "Set location"}
                </Button>
                {canToggleViewer && viewerMode === "360" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDirectionCalibrating(true)}
                  >
                    Reset direction
                  </Button>
                ) : null}
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="Add a description…"
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void patch({
                      description: description.trim()
                        ? description.trim()
                        : null,
                    })
                  }
                >
                  Save description
                </Button>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs"
                      >
                        {tag}
                        <button
                          type="button"
                          aria-label={`Remove tag ${tag}`}
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            setTags((prev) =>
                              prev.filter((item) => item !== tag),
                            )
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={tagDraft}
                      onChange={(event) => setTagDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addTag();
                        }
                      }}
                      placeholder="Add tag…"
                      className="text-sm"
                      maxLength={64}
                    />
                    <Button size="sm" variant="outline" onClick={addTag}>
                      Add
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void patch({ tags })}
                    >
                      Save tags
                    </Button>
                  </div>
                </div>
                {editMessage ? (
                  <p className="text-xs text-muted-foreground">{editMessage}</p>
                ) : null}
                <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Refresh data
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Re-queues processing jobs. Does not re-upload originals.
                  </p>
                  {!isPanorama &&
                  (asset.assetType === "video" ||
                    asset.assetType === "sequence") &&
                  (asset.hlsHeightsMissing?.length ?? 0) > 0 ? (
                    <div className="space-y-1.5 rounded-md border border-border/60 bg-background/60 px-2.5 py-2">
                      <p className="text-xs text-muted-foreground">
                        Missing streaming preview
                        {asset.hlsHeightsMissing.length === 1 ? "" : "s"}:{" "}
                        {asset.hlsHeightsMissing.join(", ")}p
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={refreshBusy}
                        onClick={() => {
                          void (async () => {
                            setRefreshBusy(true);
                            setEditMessage(null);
                            try {
                              const response = await fetch(
                                `/api/assets/${assetId}/generate-preview`,
                                { method: "POST" },
                              );
                              if (!response.ok) {
                                const payload = (await response.json().catch(
                                  () => null,
                                )) as { error?: string } | null;
                                setEditMessage(
                                  payload?.error ??
                                    "Could not queue preview generation",
                                );
                                return;
                              }
                              setEditMessage(
                                "Streaming preview queued — this page will update when ready",
                              );
                            } finally {
                              setRefreshBusy(false);
                            }
                          })();
                        }}
                      >
                        Generate streaming preview
                      </Button>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {(
                      [
                        ["thumbnails", "Thumbnails"],
                        ["metadata", "Metadata"],
                        ["dedup", "Dedup"],
                        ["webTranscoding", "Web / HLS"],
                        ["panoramaStitch", "Panorama stitch"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={refreshOpts[key]}
                          onChange={(event) =>
                            setRefreshOpts((prev) => ({
                              ...prev,
                              [key]: event.target.checked,
                            }))
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      refreshBusy ||
                      !(
                        refreshOpts.thumbnails ||
                        refreshOpts.metadata ||
                        refreshOpts.dedup ||
                        refreshOpts.webTranscoding ||
                        refreshOpts.panoramaStitch
                      )
                    }
                    onClick={() => {
                      void (async () => {
                        setRefreshBusy(true);
                        setEditMessage(null);
                        try {
                          const response = await fetch(
                            `/api/assets/${assetId}/refresh`,
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify(refreshOpts),
                            },
                          );
                          const payload = (await response.json().catch(() => null)) as {
                            message?: string;
                            error?: string;
                          } | null;
                          if (!response.ok) {
                            setEditMessage(payload?.error ?? "Refresh failed");
                            return;
                          }
                          setEditMessage(
                            payload?.message ?? "Refresh queued",
                          );
                        } finally {
                          setRefreshBusy(false);
                        }
                      })();
                    }}
                  >
                    {refreshBusy ? "Queuing…" : "Refresh data"}
                  </Button>
                </div>
              </div>
            </MetaSection>
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
                  flightPath={telemetry?.flightPath ?? null}
                  currentPosition={
                    cursor
                      ? { lat: cursor.lat, lng: cursor.lng }
                      : asset.location
                        ? {
                            lat: asset.location.lat,
                            lng: asset.location.lng,
                          }
                        : null
                  }
                  headingDegrees={
                    lookHeadingDegrees ??
                    (asset.mediaMetadata?.kind === "photo"
                      ? effectivePanoramaPoseHeading(asset.mediaMetadata)
                      : null)
                  }
                  markerKind={asset.assetType === "photo" ? "photo" : "drone"}
                  className="aspect-square w-full overflow-hidden rounded-xl"
                />
                {series.length > 1 ? (
                  <AltitudeGraph
                    series={series}
                    currentOffsetMs={currentTime * 1000}
                    className="mt-2"
                  />
                ) : null}
                {cursor?.speedMps != null || homeDistanceMeters != null ? (
                  <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {cursor?.speedMps != null ? (
                      <p>Speed {(cursor.speedMps * 3.6).toFixed(1)} km/h</p>
                    ) : null}
                    {homeDistanceMeters != null ? (
                      <p>Home {formatHomeDistance(homeDistanceMeters)}</p>
                    ) : null}
                  </div>
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

      <SetLocationModal
        open={locationModalOpen}
        initial={asset.location}
        saving={locationSaving}
        onClose={() => setLocationModalOpen(false)}
        onSave={(point) => {
          void (async () => {
            setLocationSaving(true);
            await patch({ locationOverride: point });
            setLocationSaving(false);
            setLocationModalOpen(false);
          })();
        }}
        onClear={() => {
          void (async () => {
            setLocationSaving(true);
            await patch({ locationOverride: null });
            setLocationSaving(false);
            setLocationModalOpen(false);
          })();
        }}
      />

      <AddToFlightModal
        open={flightModalOpen}
        onClose={() => setFlightModalOpen(false)}
        flights={flightsList}
        assetFlightId={asset.flightId}
        capturedAt={asset.capturedAt}
        location={asset.location}
        saving={flightSaving}
        onSelect={(flightId) => void saveFlightLink(flightId)}
        onRemove={() => void saveFlightLink(null)}
      />

      {selectedTileIndex != null ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Panorama tile"
          onClick={() => setSelectedTileIndex(null)}
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute right-4 top-4 inline-flex size-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            onClick={() => setSelectedTileIndex(null)}
          >
            <X className="size-5" />
          </button>
          <div
            className="relative h-[min(90vh,900px)] w-[min(96vw,1200px)]"
            onClick={(event) => event.stopPropagation()}
          >
            <PhotoViewer
              src={`/api/assets/${asset.id}/frames/${selectedTileIndex}`}
              alt={
                asset.sequenceFrames.find(
                  (frame) => frame.frameIndex === selectedTileIndex,
                )?.filename ?? `Tile ${selectedTileIndex + 1}`
              }
              className="absolute inset-0 size-full"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
