"use client";

import { useEffect, useRef, useState } from "react";
import { Film, ImageIcon, Images } from "lucide-react";

import type { DriveImportGroup } from "@/lib/upload/drive-scan";
import { cn } from "@/lib/utils";

const thumbCache = new Map<string, string>();
const THUMB_MAX_EDGE = 240;
const THUMB_JPEG_QUALITY = 0.68;
const MAX_CONCURRENT = 2;

/** Extensions that browsers usually can't decode cheaply for previews. */
const SKIP_DECODE = new Set(["dng", "raw", "tif", "tiff", "heic", "heif"]);

type QueueJob = () => void;
let activeJobs = 0;
const waitQueue: QueueJob[] = [];

function runNextJob() {
  if (activeJobs >= MAX_CONCURRENT) return;
  const next = waitQueue.shift();
  if (!next) return;
  activeJobs += 1;
  next();
}

function withThumbConcurrency<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      task()
        .then(resolve, reject)
        .finally(() => {
          activeJobs -= 1;
          runNextJob();
        });
    };
    waitQueue.push(start);
    runNextJob();
  });
}

function isPhotoExt(ext: string) {
  return ["jpg", "jpeg", "png", "webp"].includes(ext.toLowerCase());
}

function isVideoExt(ext: string) {
  return ["mp4", "mov", "mkv", "avi", "m4v", "webm", "insv"].includes(
    ext.toLowerCase(),
  );
}

function canvasToObjectUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("thumb encode failed"));
          return;
        }
        resolve(URL.createObjectURL(blob));
      },
      "image/jpeg",
      THUMB_JPEG_QUALITY,
    );
  });
}

function drawScaled(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
): HTMLCanvasElement {
  const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(srcW, srcH, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(srcW * scale));
  canvas.height = Math.max(1, Math.round(srcH * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function thumbFromImageFile(file: File): Promise<string> {
  // createImageBitmap decodes off-main-thread when available and we never
  // keep the full-res bitmap around after downscaling.
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = drawScaled(bitmap, bitmap.width, bitmap.height);
      return await canvasToObjectUrl(canvas);
    } finally {
      bitmap.close();
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image load failed"));
      el.src = objectUrl;
    });
    const canvas = drawScaled(
      img,
      img.naturalWidth || img.width,
      img.naturalHeight || img.height,
    );
    return await canvasToObjectUrl(canvas);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function thumbFromVideoFile(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      const onError = () => reject(new Error("video load failed"));
      video.addEventListener("loadeddata", () => resolve(), { once: true });
      video.addEventListener("error", onError, { once: true });
    });

    const target = Math.min(0.5, Math.max(0.05, (video.duration || 1) * 0.02));
    if (Number.isFinite(video.duration) && video.duration > 0) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(() => resolve(), 800);
        video.addEventListener(
          "seeked",
          () => {
            window.clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
        try {
          video.currentTime = target;
        } catch {
          window.clearTimeout(timer);
          resolve();
        }
      });
    }

    const canvas = drawScaled(
      video,
      video.videoWidth || 320,
      video.videoHeight || 180,
    );
    return await canvasToObjectUrl(canvas);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function createDriveGroupThumbnail(
  group: DriveImportGroup,
): Promise<string | null> {
  const cached = thumbCache.get(group.id);
  if (cached) return cached;

  const ext = group.primary.extension.toLowerCase();
  if (SKIP_DECODE.has(ext)) return null;

  return withThumbConcurrency(async () => {
    const again = thumbCache.get(group.id);
    if (again) return again;

    try {
      const file = await group.primary.handle.getFile();
      let url: string;
      if (
        isPhotoExt(ext) ||
        group.kind === "hyperlapse" ||
        group.kind === "panorama"
      ) {
        url = await thumbFromImageFile(file);
      } else if (isVideoExt(ext)) {
        url = await thumbFromVideoFile(file);
      } else {
        return null;
      }
      thumbCache.set(group.id, url);
      return url;
    } catch {
      return null;
    }
  });
}

export function revokeDriveThumbnails(ids?: string[]) {
  if (!ids) {
    for (const url of thumbCache.values()) {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    }
    thumbCache.clear();
    return;
  }
  for (const id of ids) {
    const url = thumbCache.get(id);
    if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    thumbCache.delete(id);
  }
}

function KindFallback({ kind }: { kind: DriveImportGroup["kind"] }) {
  if (kind === "clip") return <Film className="size-6 opacity-50" />;
  if (kind === "hyperlapse" || kind === "panorama") {
    return <Images className="size-6 opacity-50" />;
  }
  return <ImageIcon className="size-6 opacity-50" />;
}

/** Lazy, downscaled local thumbnail — only loads when scrolled into view. */
export function DriveGroupThumb({
  group,
  className,
}: {
  group: DriveImportGroup;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(
    () => thumbCache.get(group.id) ?? null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const groupRef = useRef(group);
  groupRef.current = group;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    if (thumbCache.has(group.id)) {
      setSrc(thumbCache.get(group.id)!);
      return;
    }
    void createDriveGroupThumbnail(groupRef.current).then((url) => {
      if (cancelled) return;
      if (url) setSrc(url);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, group.id]);

  return (
    <div ref={hostRef} className={cn("size-full", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="flex size-full items-center justify-center bg-zinc-800 text-zinc-400">
          {failed || !visible ? (
            <KindFallback kind={group.kind} />
          ) : (
            <span className="size-5 animate-pulse rounded-full bg-zinc-600" />
          )}
        </div>
      )}
    </div>
  );
}
