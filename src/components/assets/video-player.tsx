"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { MoreVertical, Pause, Play } from "lucide-react";

import { LutGradeCanvas } from "@/components/assets/lut-grade-canvas";
import { MediaZoomStage } from "@/components/assets/media-zoom-stage";
import {
  DEFAULT_PLAYBACK_RESOLUTION,
  pickHlsLevelForHeight,
  type PlaybackResolution,
} from "@/lib/playback/resolution";
import { cn } from "@/lib/utils";

/** Marker drawn on the timeline scrubber (e.g. max altitude). */
export type ScrubberMarker = {
  timestampOffsetMs: number;
  label: string;
};

type QualityLevel = {
  index: number;
  height: number;
  label: string;
};

/** Auto, Source (original file), or an HLS level index. */
type QualitySelection = "auto" | "source" | number;

function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function initialSelection(
  defaultResolution: PlaybackResolution,
): QualitySelection {
  return defaultResolution === "source" ? "source" : "auto";
}

function heightForSelection(
  selection: QualitySelection,
  levels: QualityLevel[],
): number | null {
  if (selection === "source" || selection === "auto") return null;
  return levels.find((level) => level.index === selection)?.height ?? null;
}

export function VideoPlayer({
  src,
  hlsSrc,
  sourceSrc,
  defaultResolution = DEFAULT_PLAYBACK_RESOLUTION,
  enabledHeights,
  previewQualitiesDisabled = false,
  lutId,
  scrubberMarkers,
  className,
  onTimeUpdate,
  onEnded,
  hideControls = false,
  autoPlay = false,
  muted = true,
  seekRequest,
}: {
  src: string;
  hlsSrc?: string | null;
  /** Progressive original (camera file) for explicit Source quality. */
  sourceSrc?: string | null;
  defaultResolution?: PlaybackResolution;
  /** Admin-enabled preview heights; when set, quality menu is filtered. */
  enabledHeights?: number[] | null;
  /** When true and Source is unavailable, show a contact-admin message. */
  previewQualitiesDisabled?: boolean;
  /** When set, grade frames through this LUT via WebGL (preview only). */
  lutId?: string | null;
  /** Timeline markers (max altitude, etc.) — not a chapters menu. */
  scrubberMarkers?: ScrubberMarker[];
  className?: string;
  onTimeUpdate?: (currentTimeSeconds: number, durationSeconds: number) => void;
  onEnded?: () => void;
  hideControls?: boolean;
  autoPlay?: boolean;
  muted?: boolean;
  /** Change `token` to force a seek (e.g. map click). */
  seekRequest?: { timeSeconds: number; token: number } | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const pendingDefaultHeight = useRef<number | null>(
    defaultResolution === "source" ? null : Number(defaultResolution),
  );
  const restoreTimeRef = useRef<number | null>(null);
  const restorePlayRef = useRef(false);

  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [selection, setSelection] = useState<QualitySelection>(() =>
    initialSelection(defaultResolution),
  );
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [lutFallback, setLutFallback] = useState<string | null>(null);
  const [gradingActive, setGradingActive] = useState(false);

  const onLutFallback = useCallback((message: string) => {
    setLutFallback(message);
    setGradingActive(false);
  }, []);

  useEffect(() => {
    setLutFallback(null);
    setGradingActive(Boolean(lutId));
  }, [lutId]);

  useEffect(() => {
    pendingDefaultHeight.current =
      defaultResolution === "source" ? null : Number(defaultResolution);
    setSelection(initialSelection(defaultResolution));
  }, [defaultResolution, src, hlsSrc, sourceSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls | null = null;
    let cancelled = false;
    video.muted = muted;
    video.volume = muted ? 0 : 1;

    const applyRestore = () => {
      if (restoreTimeRef.current != null) {
        video.currentTime = restoreTimeRef.current;
        restoreTimeRef.current = null;
      }
      if (restorePlayRef.current) {
        restorePlayRef.current = false;
        void video.play().catch(() => undefined);
      }
    };

    const useSource = selection === "source" && Boolean(sourceSrc);

    if (useSource && sourceSrc) {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.src = sourceSrc;
      video.addEventListener("loadedmetadata", applyRestore, { once: true });
      return () => {
        cancelled = true;
        video.removeEventListener("loadedmetadata", applyRestore);
      };
    }

    setLevels([]);

    if (hlsSrc && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
      });
      hls.loadSource(hlsSrc);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (cancelled) return;
        const next = hls!.levels.map((level, index) => ({
          index,
          height: level.height || 0,
          label: level.height ? `${level.height}p` : `L${index + 1}`,
        }));
        setLevels(next);

        const pending = pendingDefaultHeight.current;
        if (pending != null) {
          pendingDefaultHeight.current = null;
          const index = pickHlsLevelForHeight(next, pending);
          if (index != null) {
            hls!.currentLevel = index;
            hls!.loadLevel = index;
            hls!.nextLevel = index;
            setSelection(index);
            applyRestore();
            return;
          }
        }

        if (typeof selection === "number") {
          hls!.currentLevel = selection;
          hls!.loadLevel = selection;
          hls!.nextLevel = selection;
        } else {
          hls!.currentLevel = -1;
          hls!.loadLevel = -1;
          hls!.nextLevel = -1;
          setSelection("auto");
        }
        applyRestore();
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          hls?.destroy();
          hls = null;
          hlsRef.current = null;
          setLevels([]);
          video.src = src;
        }
      });
      hlsRef.current = hls;
    } else if (hlsSrc && video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsSrc;
      video.addEventListener("loadedmetadata", applyRestore, { once: true });
    } else {
      video.src = src;
      video.addEventListener("loadedmetadata", applyRestore, { once: true });
    }

    return () => {
      cancelled = true;
      if (hls) hls.destroy();
      hlsRef.current = null;
      video.removeEventListener("loadedmetadata", applyRestore);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selection drives media mode
  }, [src, hlsSrc, sourceSrc, selection === "source" ? "source" : "hls"]);

  useEffect(() => {
    const hls = hlsRef.current;
    if (!hls) return;
    if (selection === "source") return;
    if (selection === "auto") {
      hls.currentLevel = -1;
      hls.loadLevel = -1;
      hls.nextLevel = -1;
      return;
    }
    if (typeof selection === "number") {
      hls.nextLevel = selection;
      hls.loadLevel = selection;
      hls.currentLevel = selection;
    }
  }, [selection]);

  useEffect(() => {
    if (!seekRequest) return;
    const video = videoRef.current;
    if (!video) return;

    const apply = () => {
      video.currentTime = Math.max(0, seekRequest.timeSeconds);
      void video.play().catch(() => undefined);
    };

    if (video.readyState >= 1) {
      apply();
      return;
    }

    video.addEventListener("loadedmetadata", apply, { once: true });
    return () => video.removeEventListener("loadedmetadata", apply);
  }, [seekRequest, src, hlsSrc, sourceSrc, selection]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => {
      setCurrentTime(video.currentTime);
      setDuration(video.duration || 0);
      onTimeUpdate?.(video.currentTime, video.duration || 0);
    };
    const onEndedEvent = () => onEnded?.();
    const onMeta = () => {
      setDuration(video.duration || 0);
      if (autoPlay) void video.play().catch(() => undefined);
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("ended", onEndedEvent);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("ended", onEndedEvent);
    };
  }, [onTimeUpdate, onEnded, autoPlay]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (autoPlay) void video.play().catch(() => undefined);
    else video.pause();
  }, [autoPlay]);

  async function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) await video.play().catch(() => undefined);
    else video.pause();
  }

  function seekRatio(ratio: number) {
    const video = videoRef.current;
    if (!video || !duration) return;
    video.currentTime = Math.min(duration, Math.max(0, ratio * duration));
  }

  function rememberPosition() {
    const video = videoRef.current;
    if (!video) return;
    restoreTimeRef.current = video.currentTime;
    restorePlayRef.current = !video.paused;
  }

  function onQualityChange(next: QualitySelection) {
    const switchingMode = (selection === "source") !== (next === "source");
    if (switchingMode) {
      rememberPosition();
    }
    if (next === "auto") {
      pendingDefaultHeight.current = null;
      if (hlsRef.current) {
        hlsRef.current.currentLevel = -1;
        hlsRef.current.loadLevel = -1;
        hlsRef.current.nextLevel = -1;
      }
    }
    setSelection(next);
    setMenuOpen(false);
  }

  function onPickHeight(height: number) {
    pendingDefaultHeight.current = height;
    rememberPosition();
    if (selection === "source") {
      // Switch back to HLS; MANIFEST_PARSED applies pendingDefaultHeight.
      setSelection("auto");
    } else if (hlsRef.current && levels.length > 0) {
      const index = pickHlsLevelForHeight(levels, height);
      if (index != null) {
        hlsRef.current.currentLevel = index;
        hlsRef.current.loadLevel = index;
        hlsRef.current.nextLevel = index;
        pendingDefaultHeight.current = null;
        setSelection(index);
      } else {
        setSelection("auto");
      }
    } else {
      setSelection("auto");
    }
    setMenuOpen(false);
  }

  function setRate(rate: number) {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
    setPlaybackRate(rate);
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    video.volume = muted ? 0 : 1;
  }, [muted]);

  const progress = duration > 0 ? currentTime / duration : 0;
  const rateOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const showQualityMenu = Boolean(hlsSrc) || Boolean(sourceSrc);
  const activeHeight = heightForSelection(selection, levels);
  const useLut = Boolean(lutId) && gradingActive && !lutFallback;
  const menuHeights = useMemo(() => {
    const fromLevels = levels
      .map((level) => level.height)
      .filter((height) => height > 0);
    const unique = [...new Set(fromLevels)].sort((a, b) => a - b);
    if (enabledHeights == null) return unique;
    const allowed = new Set(enabledHeights);
    return unique.filter((height) => allowed.has(height));
  }, [levels, enabledHeights]);
  const showPreviewDisabledBanner =
    previewQualitiesDisabled && !sourceSrc && !hlsSrc;

  const markers = useMemo(() => {
    if (!scrubberMarkers?.length || duration <= 0) return [];
    return scrubberMarkers
      .map((marker) => ({
        ...marker,
        ratio: Math.min(
          1,
          Math.max(0, marker.timestampOffsetMs / 1000 / duration),
        ),
      }))
      .filter((marker) => Number.isFinite(marker.ratio));
  }, [scrubberMarkers, duration]);

  const mediaBody = (
      <div className="relative flex size-full max-h-full max-w-full items-center justify-center">
        {showPreviewDisabledBanner ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 px-6 text-center">
            <p className="max-w-sm text-sm text-white/90">
              All media preview types are disabled. Contact an administrator.
            </p>
          </div>
        ) : null}
        <video
          ref={videoRef}
          playsInline
          muted={muted}
          className={cn(
            "pointer-events-none max-h-full max-w-full object-contain",
            useLut ? "absolute inset-0 size-full opacity-0" : "size-full",
          )}
          preload="metadata"
        />
        {useLut && lutId ? (
          <LutGradeCanvas
            key={lutId}
            sourceRef={videoRef}
            lutId={lutId}
            className="size-full"
            onFallback={onLutFallback}
          />
        ) : null}
      </div>
  );

  if (hideControls) {
    return <div className={cn("relative size-full bg-black", className)}>{mediaBody}</div>;
  }

  return (
    <MediaZoomStage
      key={`${src}|${hlsSrc ?? ""}|${sourceSrc ?? ""}`}
      className={className}
      keepControlsVisible={!playing || menuOpen}
      showHints
      onEmptyClick={() => void togglePlay()}
      toolbarExtra={
        <div className="space-y-2">
          {lutFallback ? (
            <p className="text-[11px] text-amber-200/90">{lutFallback}</p>
          ) : null}
          <div className="relative pt-3">
            {markers.map((marker) => (
              <button
                key={`${marker.timestampOffsetMs}-${marker.label}`}
                type="button"
                title={marker.label}
                aria-label={marker.label}
                className="group/marker absolute top-0 z-10 -translate-x-1/2"
                style={{ left: `${marker.ratio * 100}%` }}
                onClick={() => seekRatio(marker.ratio)}
              >
                <span className="block size-2.5 rounded-full bg-amber-400 shadow ring-1 ring-black/50" />
                <span className="pointer-events-none absolute left-1/2 top-3.5 -translate-x-1/2 whitespace-nowrap rounded bg-black/85 px-1.5 py-0.5 text-[10px] text-amber-100 opacity-0 transition group-hover/marker:opacity-100">
                  Max alt
                </span>
              </button>
            ))}
            <input
              type="range"
              min={0}
              max={1000}
              value={Math.round(progress * 1000)}
              aria-label="Seek"
              className="dm-media-range w-full"
              onChange={(event) => seekRatio(Number(event.target.value) / 1000)}
            />
          </div>

          <div className="flex items-center gap-1.5 text-white">
            <button
              type="button"
              aria-label={playing ? "Pause" : "Play"}
              className="inline-flex size-9 items-center justify-center rounded-full hover:bg-white/15"
              onClick={() => void togglePlay()}
            >
              {playing ? (
                <Pause className="size-5 fill-current" />
              ) : (
                <Play className="size-5 fill-current" />
              )}
            </button>

            <span className="min-w-[5.5rem] px-1 text-xs tabular-nums text-white/90">
              {formatClock(currentTime)} / {formatClock(duration)}
            </span>

            <div className="relative ml-auto">
              <button
                type="button"
                aria-label="More"
                className="inline-flex size-9 items-center justify-center rounded-full hover:bg-white/15"
                onClick={() => setMenuOpen((value) => !value)}
              >
                <MoreVertical className="size-5" />
              </button>
              {menuOpen ? (
                <div className="absolute bottom-11 right-0 z-20 w-44 overflow-hidden rounded-xl border border-white/15 bg-black/90 py-1 text-sm shadow-lg backdrop-blur">
                  <div className="border-b border-white/10 px-3 py-2">
                    <p className="mb-1 text-[11px] uppercase tracking-wide text-white/50">
                      Speed
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {rateOptions.map((rate) => (
                        <button
                          key={rate}
                          type="button"
                          className={cn(
                            "rounded-md px-2 py-1 text-xs hover:bg-white/10",
                            playbackRate === rate && "bg-white/15 text-primary",
                          )}
                          onClick={() => {
                            setRate(rate);
                            setMenuOpen(false);
                          }}
                        >
                          {rate === 1 ? "1×" : `${rate}×`}
                        </button>
                      ))}
                    </div>
                  </div>
                  {showQualityMenu ? (
                    <div className="px-3 py-2">
                      <p className="mb-1 text-[11px] uppercase tracking-wide text-white/50">
                        Quality
                      </p>
                      {hlsSrc ? (
                        <>
                          <button
                            type="button"
                            className={cn(
                              "block w-full rounded-md px-2 py-1 text-left hover:bg-white/10",
                              selection === "auto" &&
                                activeHeight == null &&
                                "text-primary",
                            )}
                            onClick={() => onQualityChange("auto")}
                          >
                            Auto
                          </button>
                          {menuHeights.map((height) => (
                            <button
                              key={height}
                              type="button"
                              className={cn(
                                "block w-full rounded-md px-2 py-1 text-left hover:bg-white/10",
                                activeHeight === height && "text-primary",
                              )}
                              onClick={() => onPickHeight(height)}
                            >
                              {height}
                            </button>
                          ))}
                        </>
                      ) : null}
                      {sourceSrc ? (
                        <button
                          type="button"
                          className={cn(
                            "block w-full rounded-md px-2 py-1 text-left hover:bg-white/10",
                            selection === "source" && "text-primary",
                          )}
                          onClick={() => onQualityChange("source")}
                        >
                          Source
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      }
    >
      {mediaBody}
    </MediaZoomStage>
  );
}

export function useTelemetryCursor(
  series: Array<{
    lat: number;
    lng: number;
    altitudeMeters: number;
    offsetMs: number;
    srtTimeMs?: number;
    speedMps: number | null;
  }>,
  currentTimeSeconds: number,
) {
  return useMemo(() => {
    if (series.length === 0) return null;
    const tMs = Math.max(0, currentTimeSeconds * 1000);
    let best = series[0]!;
    for (const point of series) {
      if (point.offsetMs <= tMs) best = point;
      else break;
    }
    return best;
  }, [series, currentTimeSeconds]);
}
