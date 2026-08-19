"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Pause,
  Play,
  Shuffle,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

import { LutGradeCanvas } from "@/components/assets/lut-grade-canvas";
import { assetThumbnailSrc } from "@/lib/assets/thumbnail-url";
import type { AlbumSummaryDto } from "@/lib/albums/queries";
import type { CinemaPlaylistItem, CinemaSource } from "@/lib/cinema/queries";
import { cn } from "@/lib/utils";

const VideoPlayer = dynamic(
  () =>
    import("@/components/assets/video-player").then((m) => m.VideoPlayer),
  { ssr: false },
);

const PHOTO_HOLD_MS = 5000;

function shuffleItems<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const current = next[i]!;
    next[i] = next[j]!;
    next[j] = current;
  }
  return next;
}

function isPhotoLike(item: CinemaPlaylistItem) {
  return (
    item.assetType === "photo" ||
    (item.assetType === "sequence" && item.sequenceKind === "panorama")
  );
}

type LutOption = { id: string; name: string };

function CinemaStill({
  item,
  lutId,
  playing,
  reduceMotion,
  onReady,
}: {
  item: CinemaPlaylistItem;
  lutId: string | null;
  playing: boolean;
  reduceMotion: boolean;
  onReady: () => void;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [src, setSrc] = useState(assetThumbnailSrc(item.id));
  const [lutFallback, setLutFallback] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const original = `/api/assets/${item.id}/original`;
  const useLut = Boolean(lutId) && loaded && !lutFallback;

  useEffect(() => {
    setSrc(assetThumbnailSrc(item.id));
    setLutFallback(false);
    setLoaded(false);
  }, [item.id]);

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imageRef}
        src={src}
        alt={item.displayName}
        className={cn(
          "max-h-full max-w-full object-contain",
          !reduceMotion ? "dm-kenburns" : "",
        )}
        style={{ animationPlayState: playing ? "running" : "paused" }}
        onLoad={() => {
          setLoaded(true);
          onReady();
          if (src !== original) setSrc(original);
        }}
        onError={() => {
          if (src !== original) {
            setSrc(original);
            return;
          }
          onReady();
        }}
      />
      {useLut && lutId ? (
        <LutGradeCanvas
          key={`${item.id}-${lutId}`}
          sourceRef={imageRef}
          lutId={lutId}
          className={cn(
            "max-h-full max-w-full",
            !reduceMotion ? "dm-kenburns" : "",
          )}
          onFallback={() => setLutFallback(true)}
        />
      ) : null}
    </div>
  );
}

export function CinematicPlayer() {
  const router = useRouter();
  const photoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [hover, setHover] = useState(true);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<CinemaPlaylistItem[]>([]);
  const [index, setIndex] = useState(0);
  const [source, setSource] = useState<CinemaSource>("all");
  const [albumIds, setAlbumIds] = useState<string[]>([]);
  const [albums, setAlbums] = useState<AlbumSummaryDto[]>([]);
  const [lutId, setLutId] = useState<string | null>(null);
  const [previewLutId, setPreviewLutId] = useState<string | null>(null);
  const [luts, setLuts] = useState<LutOption[]>([]);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [stillReady, setStillReady] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = items[index] ?? null;
  const effectiveLut = lutId ?? current?.preferredLutId ?? previewLutId;

  const loadPlaylist = useCallback(
    async (nextSource: CinemaSource, nextAlbumIds: string[]) => {
      const params = new URLSearchParams({ source: nextSource });
      if (nextSource === "albums" && nextAlbumIds.length > 0) {
        params.set("albumIds", nextAlbumIds.join(","));
      }
      const response = await fetch(`/api/cinema/playlist?${params}`);
      if (!response.ok) {
        setError("Failed to load cinematic playlist");
        setItems([]);
        return;
      }
      const payload = (await response.json()) as {
        items: CinemaPlaylistItem[];
      };
      setItems(shuffleItems(payload.items));
      setIndex(0);
      setError(null);
    },
    [],
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(media.matches);
    const onChange = () => setReduceMotion(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [accountRes, albumsRes, lutsRes] = await Promise.all([
        fetch("/api/account"),
        fetch("/api/albums"),
        fetch("/api/luts"),
      ]);
      if (cancelled) return;
      let nextSource: CinemaSource = "all";
      let nextAlbumIds: string[] = [];
      if (accountRes.ok) {
        const account = (await accountRes.json()) as {
          preferences?: {
            cinematicSource?: CinemaSource;
            cinematicAlbumIds?: string[];
            cinematicLutId?: string | null;
            previewLutId?: string | null;
          };
        };
        nextSource = account.preferences?.cinematicSource ?? "all";
        nextAlbumIds = account.preferences?.cinematicAlbumIds ?? [];
        setSource(nextSource);
        setAlbumIds(nextAlbumIds);
        setLutId(account.preferences?.cinematicLutId ?? null);
        setPreviewLutId(account.preferences?.previewLutId ?? null);
      }
      if (albumsRes.ok) {
        const payload = (await albumsRes.json()) as { albums: AlbumSummaryDto[] };
        setAlbums(payload.albums);
      }
      if (lutsRes.ok) {
        const payload = (await lutsRes.json()) as { luts: LutOption[] };
        setLuts(payload.luts);
      }
      await loadPlaylist(nextSource, nextAlbumIds);
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPlaylist]);

  function persistPrefs(partial: {
    cinematicSource?: CinemaSource;
    cinematicAlbumIds?: string[];
    cinematicLutId?: string | null;
  }) {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void fetch("/api/account/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
    }, 400);
  }

  const photoLike = current ? isPhotoLike(current) : false;
  const videoLike = Boolean(current && !photoLike);

  const goNext = useCallback(() => {
    setIndex((value) => {
      if (items.length === 0) return 0;
      return (value + 1) % items.length;
    });
  }, [items.length]);

  useEffect(() => {
    setStillReady(false);
  }, [current?.id]);

  useEffect(() => {
    if (photoTimer.current) {
      clearTimeout(photoTimer.current);
      photoTimer.current = null;
    }
    if (!playing || !current || !photoLike || !stillReady) return;
    photoTimer.current = setTimeout(goNext, PHOTO_HOLD_MS);
    return () => {
      if (photoTimer.current) clearTimeout(photoTimer.current);
    };
  }, [current, photoLike, playing, goNext, index, stillReady]);

  useEffect(() => {
    if (!videoLike || !current) return;
    if (!current.hasHls) {
      const timer = setTimeout(goNext, 900);
      return () => clearTimeout(timer);
    }
  }, [current, videoLike, goNext]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") router.push("/");
      if (event.key === " ") {
        event.preventDefault();
        setPlaying((value) => !value);
      }
      if (event.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, goNext]);

  const empty = ready && items.length === 0;
  const skipVideo = videoLike && current && !current.hasHls;

  const sourceLabel = useMemo(() => {
    if (source === "favorites") return "Favourites";
    if (source === "albums") return "Selected albums";
    return "All media";
  }, [source]);

  function bumpHover() {
    setHover(true);
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHover(false), 2800);
  }

  useEffect(() => {
    bumpHover();
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="relative h-dvh w-full overflow-hidden bg-black"
      onMouseMove={bumpHover}
      onMouseLeave={() => setHover(false)}
    >
      {!current && !empty ? (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
          Loading cinematic…
        </p>
      ) : null}

      {empty ? (
        <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/70">
          {error ?? "No media to play. Try another source in the hover menu."}
        </p>
      ) : null}

      {current && photoLike ? (
        <CinemaStill
          item={current}
          lutId={effectiveLut}
          playing={playing}
          reduceMotion={reduceMotion}
          onReady={() => setStillReady(true)}
        />
      ) : null}

      {current && videoLike && current.hasHls ? (
        <VideoPlayer
          key={current.id}
          src={`/api/assets/${current.id}/hls/index.m3u8`}
          hlsSrc={`/api/assets/${current.id}/hls/index.m3u8`}
          sourceSrc={null}
          defaultResolution="1080"
          lutId={effectiveLut}
          hideControls
          autoPlay={playing}
          muted={muted}
          className="absolute inset-0 size-full"
          onEnded={goNext}
        />
      ) : null}

      {skipVideo ? (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
          No streaming preview — skipping
        </p>
      ) : null}

      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/40 transition-opacity duration-300",
          hover ? "opacity-100" : "opacity-0",
        )}
      />

      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-10 space-y-4 p-6 text-white transition-opacity duration-300",
          hover ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
        onMouseEnter={() => {
          if (hoverTimer.current) clearTimeout(hoverTimer.current);
          setHover(true);
        }}
        onMouseLeave={bumpHover}
      >
        <div>
          <p className="text-lg font-medium">{current?.displayName ?? "Cinematic"}</p>
          <p className="text-xs text-white/60">
            {sourceLabel}
            {items.length > 0
              ? ` · ${index + 1} / ${items.length}`
              : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => setPlaying((value) => !value)}
          >
            {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
          </button>
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            aria-label="Next"
            onClick={goNext}
          >
            <ChevronRight className="size-5" />
          </button>
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            aria-label="Shuffle"
            onClick={() => {
              setItems((currentItems) => shuffleItems(currentItems));
              setIndex(0);
            }}
          >
            <Shuffle className="size-5" />
          </button>
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            aria-label={muted ? "Unmute" : "Mute"}
            onClick={() => setMuted((value) => !value)}
          >
            {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </button>
          <button
            type="button"
            className="ml-auto inline-flex size-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            aria-label="Close"
            onClick={() => router.push("/")}
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-4 text-xs">
          <label className="space-y-1">
            <span className="block text-white/60">Source</span>
            <select
              value={source}
              className="h-9 rounded-lg border border-white/15 bg-black/70 px-2 text-white"
              onChange={(event) => {
                const next = event.target.value as CinemaSource;
                setSource(next);
                persistPrefs({ cinematicSource: next });
                void loadPlaylist(next, albumIds);
              }}
            >
              <option value="all">All media</option>
              <option value="favorites">Favourites</option>
              <option value="albums">Selected albums</option>
            </select>
          </label>

          {source === "albums" ? (
            <fieldset className="max-h-28 max-w-sm overflow-auto rounded-lg border border-white/15 bg-black/50 px-2 py-1">
              <legend className="px-1 text-white/60">Albums</legend>
              {albums.length === 0 ? (
                <p className="py-1 text-white/50">No albums</p>
              ) : (
                albums.map((album) => (
                  <label
                    key={album.id}
                    className="flex items-center gap-2 py-0.5"
                  >
                    <input
                      type="checkbox"
                      checked={albumIds.includes(album.id)}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...albumIds, album.id]
                          : albumIds.filter((id) => id !== album.id);
                        setAlbumIds(next);
                        persistPrefs({ cinematicAlbumIds: next });
                        void loadPlaylist("albums", next);
                      }}
                    />
                    <span className="truncate">{album.name}</span>
                  </label>
                ))
              )}
            </fieldset>
          ) : null}

          <label className="space-y-1">
            <span className="block text-white/60">LUT</span>
            <select
              value={lutId ?? ""}
              className="h-9 min-w-40 rounded-lg border border-white/15 bg-black/70 px-2 text-white"
              onChange={(event) => {
                const next = event.target.value || null;
                setLutId(next);
                persistPrefs({ cinematicLutId: next });
              }}
            >
              <option value="">Default preview LUT</option>
              {luts.map((lut) => (
                <option key={lut.id} value={lut.id}>
                  {lut.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}
