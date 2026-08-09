"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { LutGradeCanvas } from "@/components/assets/lut-grade-canvas";
import { MediaZoomStage } from "@/components/assets/media-zoom-stage";
import { cn } from "@/lib/utils";

type PhotoQuality = "web" | "source";

export function PhotoViewer({
  src,
  sourceSrc,
  alt,
  lutId,
  className,
}: {
  /** Default in-app view (cache web preview). */
  src: string;
  /** Full-resolution original on media. When set, shows Web / Source control. */
  sourceSrc?: string | null;
  alt: string;
  lutId?: string | null;
  className?: string;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [quality, setQuality] = useState<PhotoQuality>("web");
  const [actualSizeScale, setActualSizeScale] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(
    null,
  );
  const [lutFallback, setLutFallback] = useState<string | null>(null);
  const [gradingActive, setGradingActive] = useState(false);

  const activeSrc =
    quality === "source" && sourceSrc ? sourceSrc : src;

  const onLutFallback = useCallback((message: string) => {
    setLutFallback(message);
    setGradingActive(false);
  }, []);

  useEffect(() => {
    setQuality("web");
    setLutFallback(null);
    setGradingActive(Boolean(lutId));
  }, [lutId, src, sourceSrc]);

  const useLut = Boolean(lutId) && gradingActive && !lutFallback;

  return (
    <MediaZoomStage
      key={activeSrc}
      className={className}
      actualSizeScale={actualSizeScale}
      showHints
      toolbarExtra={
        <div className="space-y-1">
          {sourceSrc ? (
            <div className="flex gap-1 px-1">
              {(
                [
                  ["web", "Web"],
                  ["source", "Source"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setQuality(value)}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[11px] font-medium transition",
                    quality === value
                      ? "bg-white/20 text-white"
                      : "text-white/55 hover:bg-white/10 hover:text-white/80",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          {lutFallback ? (
            <p className="px-1 text-[11px] text-amber-200/90">{lutFallback}</p>
          ) : null}
          {dimensions ? (
            <p className="px-1 text-[11px] tabular-nums text-white/55">
              {dimensions.w}×{dimensions.h}
            </p>
          ) : null}
        </div>
      }
    >
      <div className="relative flex size-full max-h-full max-w-full items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={activeSrc}
          alt={alt}
          draggable={false}
          className={cn(
            "pointer-events-none max-h-full max-w-full select-none object-contain",
            "[-webkit-user-drag:none]",
            useLut && "absolute inset-0 size-full opacity-0",
          )}
          onDragStart={(event) => event.preventDefault()}
          onLoad={(event) => {
            const img = event.currentTarget;
            const naturalW = img.naturalWidth;
            const naturalH = img.naturalHeight;
            setDimensions({ w: naturalW, h: naturalH });
            const renderedW = img.clientWidth;
            if (naturalW > 0 && renderedW > 0) {
              setActualSizeScale(naturalW / renderedW);
            } else {
              setActualSizeScale(null);
            }
          }}
        />
        {useLut && lutId ? (
          <LutGradeCanvas
            key={lutId}
            sourceRef={imageRef}
            lutId={lutId}
            className="size-full"
            onFallback={onLutFallback}
          />
        ) : null}
      </div>
    </MediaZoomStage>
  );
}
