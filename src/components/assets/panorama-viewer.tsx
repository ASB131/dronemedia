"use client";

import { useEffect, useRef, useState } from "react";
import { Viewer } from "@photo-sphere-viewer/core";
import "@photo-sphere-viewer/core/index.css";

import { cn } from "@/lib/utils";

/** Soft cap so WebGL/canvas never exceeds common MAX_TEXTURE_SIZE. */
const VIEW_MAX_EDGE = 16384;

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

export function PanoramaViewer({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;
    setError(null);

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
      viewerRef.current?.destroy();
      viewerRef.current = null;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [src]);

  return (
    <div
      className={cn("relative size-full bg-black", className)}
    >
      <div
        ref={containerRef}
        className="size-full [&_.psv-container]:size-full"
      />
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
          <p className="text-sm text-white/85">{error}</p>
        </div>
      ) : null}
    </div>
  );
}
