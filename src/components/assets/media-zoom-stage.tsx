"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  Maximize,
  Minimize,
  RotateCcw,
  Scan,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { cn } from "@/lib/utils";

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.25;
const WHEEL_SENSITIVITY = 0.0018;
const DRAG_THRESHOLD_PX = 4;

export type MediaZoomTransform = {
  scale: number;
  x: number;
  y: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundScale(scale: number) {
  return Math.round(scale * 100) / 100;
}

function constrainTransform(
  next: MediaZoomTransform,
  stageW: number,
  stageH: number,
): MediaZoomTransform {
  const scale = clamp(next.scale, MIN_SCALE, MAX_SCALE);
  if (scale <= 1.001 || stageW <= 0 || stageH <= 0) {
    return { scale: 1, x: 0, y: 0 };
  }
  const maxX = (stageW * (scale - 1)) / 2;
  const maxY = (stageH * (scale - 1)) / 2;
  return {
    scale,
    x: clamp(next.x, -maxX, maxX),
    y: clamp(next.y, -maxY, maxY),
  };
}

export function MediaZoomStage({
  children,
  className,
  toolbarExtra,
  showHints = true,
  actualSizeScale,
  keepControlsVisible = false,
  onInteract,
  onEmptyClick,
}: {
  children: ReactNode;
  className?: string;
  /** Extra controls rendered above the zoom row (e.g. video transport). */
  toolbarExtra?: ReactNode;
  showHints?: boolean;
  /** Optional scale for “actual size” (e.g. 1 / object-fit scale). */
  actualSizeScale?: number | null;
  /** Keep the bottom bar visible (e.g. paused video / open menu). */
  keepControlsVisible?: boolean;
  onInteract?: () => void;
  /** Fired on a click that was not a pan drag (useful for play/pause). */
  onEmptyClick?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<MediaZoomTransform>({ scale: 1, x: 0, y: 0 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
    panning: boolean;
  } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingRef = useRef(false);

  const [transform, setTransform] = useState<MediaZoomTransform>({
    scale: 1,
    x: 0,
    y: 0,
  });
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [dragging, setDragging] = useState(false);

  transformRef.current = transform;
  const zoomed = transform.scale > 1.001;

  const bumpControls = useCallback(() => {
    setControlsVisible(true);
    onInteract?.();
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!dragging && !keepControlsVisible) setControlsVisible(false);
    }, 2500);
  }, [dragging, keepControlsVisible, onInteract]);

  useEffect(() => {
    if (keepControlsVisible) setControlsVisible(true);
  }, [keepControlsVisible]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  useEffect(() => {
    function onFs() {
      setFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const applyTransform = useCallback((next: MediaZoomTransform) => {
    const stage = stageRef.current;
    const stageW = stage?.clientWidth ?? 0;
    const stageH = stage?.clientHeight ?? 0;
    setTransform(constrainTransform(next, stageW, stageH));
  }, []);

  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const stage = stageRef.current;
      const current = transformRef.current;
      const nextScale = roundScale(
        clamp(current.scale * factor, MIN_SCALE, MAX_SCALE),
      );
      if (!stage || nextScale === current.scale) {
        applyTransform({ ...current, scale: nextScale });
        return;
      }

      const rect = stage.getBoundingClientRect();
      const pivotX =
        clientX != null ? clientX - rect.left - rect.width / 2 : 0;
      const pivotY =
        clientY != null ? clientY - rect.top - rect.height / 2 : 0;
      const ratio = nextScale / current.scale;

      applyTransform({
        scale: nextScale,
        x: pivotX - (pivotX - current.x) * ratio,
        y: pivotY - (pivotY - current.y) * ratio,
      });
    },
    [applyTransform],
  );

  const resetView = useCallback(() => {
    applyTransform({ scale: 1, x: 0, y: 0 });
  }, [applyTransform]);

  const zoomToActual = useCallback(() => {
    if (!actualSizeScale || !Number.isFinite(actualSizeScale)) return;
    applyTransform({
      scale: roundScale(clamp(actualSizeScale, MIN_SCALE, MAX_SCALE)),
      x: 0,
      y: 0,
    });
  }, [actualSizeScale, applyTransform]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    function onWheelNative(event: WheelEvent) {
      event.preventDefault();
      bumpControls();
      const factor = Math.exp(-event.deltaY * WHEEL_SENSITIVITY);
      zoomAt(factor, event.clientX, event.clientY);
    }
    stage.addEventListener("wheel", onWheelNative, { passive: false });
    return () => stage.removeEventListener("wheel", onWheelNative);
  }, [bumpControls, zoomAt]);

  async function toggleFullscreen() {
    const root = rootRef.current;
    if (!root) return;
    if (!document.fullscreenElement) {
      await root.requestFullscreen().catch(() => undefined);
    } else {
      await document.exitFullscreen().catch(() => undefined);
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-controls]")) return;
    // Block native image/file drag which steals the gesture from pan.
    event.preventDefault();
    bumpControls();
    event.currentTarget.setPointerCapture(event.pointerId);
    const canPan = transformRef.current.scale > 1.001;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transformRef.current.x,
      originY: transformRef.current.y,
      moved: false,
      panning: canPan,
    };
    // Sync ref so transform transition is off immediately (setState is async).
    draggingRef.current = canPan;
    if (canPan) setDragging(true);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (
      !drag.moved &&
      (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)
    ) {
      drag.moved = true;
    }
    if (!drag.panning) return;
    applyTransform({
      scale: transformRef.current.scale,
      x: drag.originX + dx,
      y: drag.originY + dy,
    });
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    draggingRef.current = false;
    setDragging(false);
    bumpControls();
    if (!drag.moved) {
      onEmptyClick?.();
    }
  }

  function onDoubleClick(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("[data-controls]")) return;
    bumpControls();
    if (transformRef.current.scale > 1.05) {
      resetView();
    } else {
      zoomAt(2.5, event.clientX, event.clientY);
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomAt(ZOOM_STEP);
        bumpControls();
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomAt(1 / ZOOM_STEP);
        bumpControls();
      } else if (event.key === "0") {
        event.preventDefault();
        resetView();
        bumpControls();
      } else if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        void toggleFullscreen();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bumpControls, resetView, zoomAt]);

  const scaleLabel = `${Math.round(transform.scale * 100)}%`;

  return (
    <div
      ref={rootRef}
      className={cn(
        "group relative size-full overflow-hidden bg-black",
        className,
      )}
      onMouseMove={bumpControls}
      onMouseLeave={() => {
        if (!dragging && !keepControlsVisible) setControlsVisible(false);
      }}
    >
      <div
        ref={stageRef}
        className={cn(
          "absolute inset-0 touch-none select-none overflow-hidden",
          zoomed
            ? dragging
              ? "cursor-grabbing"
              : "cursor-grab"
            : "cursor-default",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onDoubleClick}
        onDragStart={(event) => event.preventDefault()}
      >
        <div
          className="flex size-full items-center justify-center will-change-transform"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: "center center",
            // Prefer ref so the first pan frame isn't eased (setState lags a tick).
            transition:
              draggingRef.current || dragging
                ? "none"
                : "transform 100ms ease-out",
          }}
        >
          {children}
        </div>
      </div>

      <div
        data-controls
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-3 pb-3 pt-14 transition-opacity duration-200",
          controlsVisible || dragging || keepControlsVisible
            ? "opacity-100"
            : "opacity-0",
        )}
      >
        <div className="pointer-events-auto flex flex-col gap-2 text-white">
          {toolbarExtra}
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Zoom out"
              title="Zoom out (−)"
              className="inline-flex size-9 items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-40"
              disabled={transform.scale <= MIN_SCALE}
              onClick={() => {
                zoomAt(1 / ZOOM_STEP);
                bumpControls();
              }}
            >
              <ZoomOut className="size-5" />
            </button>
            <span className="min-w-[3.25rem] text-center text-xs tabular-nums text-white/90">
              {scaleLabel}
            </span>
            <button
              type="button"
              aria-label="Zoom in"
              title="Zoom in (+)"
              className="inline-flex size-9 items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-40"
              disabled={transform.scale >= MAX_SCALE}
              onClick={() => {
                zoomAt(ZOOM_STEP);
                bumpControls();
              }}
            >
              <ZoomIn className="size-5" />
            </button>
            <button
              type="button"
              aria-label="Fit to view"
              title="Fit (0)"
              className="ml-1 inline-flex size-9 items-center justify-center rounded-full hover:bg-white/15"
              onClick={() => {
                resetView();
                bumpControls();
              }}
            >
              <RotateCcw className="size-5" />
            </button>
            {actualSizeScale != null && actualSizeScale > 1.01 ? (
              <button
                type="button"
                aria-label="Actual size"
                title="Actual size"
                className="inline-flex size-9 items-center justify-center rounded-full hover:bg-white/15"
                onClick={() => {
                  zoomToActual();
                  bumpControls();
                }}
              >
                <Scan className="size-5" />
              </button>
            ) : null}

            <div className="ml-auto flex items-center gap-2">
              {showHints ? (
                <span className="hidden text-[11px] text-white/55 sm:inline">
                  Scroll to zoom
                  {zoomed ? " · drag to pan" : ""}
                </span>
              ) : null}
              <button
                type="button"
                aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                title={fullscreen ? "Exit fullscreen" : "Fullscreen (F)"}
                className="inline-flex size-9 items-center justify-center rounded-full hover:bg-white/15"
                onClick={() => void toggleFullscreen()}
              >
                {fullscreen ? (
                  <Minimize className="size-5" />
                ) : (
                  <Maximize className="size-5" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
