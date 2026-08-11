"use client";

import { useEffect, useRef, useState } from "react";
import { Viewer } from "@photo-sphere-viewer/core";
import "@photo-sphere-viewer/core/index.css";

import {
  lookHeadingDegrees,
  normalizeHeadingDegrees,
} from "@/lib/assets/panorama-heading";
import { cn } from "@/lib/utils";

/** Soft cap so WebGL/canvas never exceeds common MAX_TEXTURE_SIZE. */
const VIEW_MAX_EDGE = 16384;

/** Pixels per degree on the heading tape. */
const PX_PER_DEG = 4;
/** Degrees visible on each side of center. */
const TAPE_HALF_SPAN = 70;
const TICK_STEP = 10;
const CARDINALS: Record<number, string> = {
  0: "N",
  45: "NE",
  90: "E",
  135: "SE",
  180: "S",
  225: "SW",
  270: "W",
  315: "NW",
};

/** Signed shortest delta from `from` to `to` in degrees, range (-180, 180]. */
function headingDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

async function loadViewerPanorama(src: string): Promise<string> {
  const response = await fetch(src, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`Panorama HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Failed to decode panorama image"));
    el.src = objectUrl;
  });

  const maxEdge = Math.max(img.naturalWidth, img.naturalHeight);
  if (maxEdge <= VIEW_MAX_EDGE) {
    return objectUrl;
  }

  const scale = VIEW_MAX_EDGE / maxEdge;
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return objectUrl;
  }
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(objectUrl);

  const resized = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas encode failed"))),
      "image/jpeg",
      0.92,
    );
  });
  return URL.createObjectURL(resized);
}

function HeadingTape({ heading }: { heading: number }) {
  const h = normalizeHeadingDegrees(heading) ?? 0;
  // Absolute compass ticks, positioned by continuous delta so N/E/S/W never
  // drop out when the rounded heading isn't on a 5° grid.
  const marks: Array<{
    deg: number;
    delta: number;
    label: string | null;
    major: boolean;
  }> = [];
  for (let deg = 0; deg < 360; deg += TICK_STEP) {
    const delta = headingDelta(h, deg);
    if (Math.abs(delta) > TAPE_HALF_SPAN) continue;
    marks.push({
      deg,
      delta,
      label: CARDINALS[deg] ?? null,
      major: deg % 45 === 0,
    });
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center pt-2.5">
      <div className="relative h-12 w-[min(88%,24rem)] overflow-hidden">
        <div
          className="absolute inset-y-1 left-1/2 z-10 w-px -translate-x-1/2 bg-white/90"
          aria-hidden
        />
        <div
          className="absolute left-1/2 top-0 z-10 -translate-x-1/2 border-x-[4px] border-t-[6px] border-x-transparent border-t-white"
          aria-hidden
        />
        {marks.map((mark) => (
          <div
            key={mark.deg}
            className="absolute bottom-5 flex flex-col items-center"
            style={{
              left: `calc(50% + ${mark.delta * PX_PER_DEG}px)`,
              transform: "translateX(-50%)",
            }}
          >
            {mark.label ? (
              <span
                className={cn(
                  "mb-0.5 font-mono text-[10px] tracking-wide text-white/75",
                  mark.deg % 90 === 0 && "text-[11px] font-semibold text-white",
                )}
              >
                {mark.label}
              </span>
            ) : (
              <span className="mb-0.5 h-3.5" />
            )}
            <span
              className={cn(
                "w-px bg-white/45",
                mark.major ? "h-3 bg-white/85" : "h-1.5",
              )}
            />
          </div>
        ))}
        <div className="absolute inset-x-0 bottom-0 flex justify-center">
          <span className="font-mono text-xs tabular-nums text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
            {Math.round(h).toString().padStart(3, "0")}°
          </span>
        </div>
      </div>
    </div>
  );
}

export function PanoramaViewer({
  src,
  poseHeadingDegrees = null,
  onLookHeadingChange,
  className,
}: {
  /** Cache web preview of the large pano. */
  src: string;
  /** Real geographic heading of equirect center; omit tape when null. */
  poseHeadingDegrees?: number | null;
  /** Live look heading while the user pans (same value as the compass tape). */
  onLookHeadingChange?: (headingDegrees: number | null) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const poseRef = useRef(poseHeadingDegrees);
  const onLookHeadingChangeRef = useRef(onLookHeadingChange);
  const lastLookEmitAtRef = useRef(0);
  const trailingLookEmitRef = useRef<number | null>(null);
  const pendingLookHeadingRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  poseRef.current = poseHeadingDegrees;
  onLookHeadingChangeRef.current = onLookHeadingChange;

  const emitLookHeading = (next: number | null, force = false) => {
    const notify = onLookHeadingChangeRef.current;
    if (!notify) return;

    pendingLookHeadingRef.current = next;

    if (next == null || force) {
      if (trailingLookEmitRef.current != null) {
        window.clearTimeout(trailingLookEmitRef.current);
        trailingLookEmitRef.current = null;
      }
      lastLookEmitAtRef.current = performance.now();
      notify(next);
      return;
    }

    const now = performance.now();
    const elapsed = now - lastLookEmitAtRef.current;
    if (elapsed >= 50) {
      lastLookEmitAtRef.current = now;
      notify(next);
      return;
    }

    if (trailingLookEmitRef.current != null) return;
    trailingLookEmitRef.current = window.setTimeout(() => {
      trailingLookEmitRef.current = null;
      lastLookEmitAtRef.current = performance.now();
      onLookHeadingChangeRef.current?.(pendingLookHeadingRef.current);
    }, 50 - elapsed);
  };

  const syncFromViewer = (viewer: Viewer, force = false) => {
    const pose = poseRef.current;
    if (pose == null || !Number.isFinite(pose)) {
      setHeading(null);
      emitLookHeading(null, true);
      return;
    }
    try {
      const { yaw } = viewer.getPosition();
      // Same geographic look heading as the compass tape so the map cone matches.
      const look = lookHeadingDegrees(pose, yaw);
      setHeading(look);
      emitLookHeading(look, force);
    } catch {
      setHeading(null);
      emitLookHeading(null, true);
    }
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;
    setError(null);
    setHeading(null);
    emitLookHeading(null, true);

    void (async () => {
      try {
        const panorama = await loadViewerPanorama(src);
        if (cancelled) {
          URL.revokeObjectURL(panorama);
          return;
        }
        objectUrlRef.current = panorama;

        const viewer = new Viewer({
          container: el,
          panorama,
          navbar: ["zoom", "move", "fullscreen"],
          defaultZoomLvl: 0,
          minFov: 10,
          maxFov: 90,
          mousewheel: true,
          mousemove: true,
          touchmoveTwoFingers: true,
          withCredentials: true,
          loadingTxt: "Loading panorama…",
        });
        viewerRef.current = viewer;

        const syncHeading = () => syncFromViewer(viewer);
        viewer.addEventListener("ready", () => syncFromViewer(viewer, true));
        viewer.addEventListener("position-updated", syncHeading);
        syncHeading();
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "The panorama cannot be loaded",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      if (trailingLookEmitRef.current != null) {
        window.clearTimeout(trailingLookEmitRef.current);
        trailingLookEmitRef.current = null;
      }
      viewerRef.current?.destroy();
      viewerRef.current = null;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      onLookHeadingChangeRef.current?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync helpers use refs
  }, [src, poseHeadingDegrees]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) {
      if (poseHeadingDegrees == null) {
        setHeading(null);
        emitLookHeading(null, true);
      }
      return;
    }
    syncFromViewer(viewer, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync helpers use refs
  }, [poseHeadingDegrees]);

  const showTape =
    heading != null &&
    poseHeadingDegrees != null &&
    Number.isFinite(poseHeadingDegrees) &&
    (hovered || focused);

  return (
    <div
      className={cn("relative size-full bg-black", className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <div
        ref={containerRef}
        className="size-full [&_.psv-container]:size-full"
        tabIndex={0}
      />
      {showTape ? <HeadingTape heading={heading} /> : null}
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
          <p className="text-sm text-white/85">{error}</p>
        </div>
      ) : null}
    </div>
  );
}
