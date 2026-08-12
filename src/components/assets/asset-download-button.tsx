"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";

import { cn } from "@/lib/utils";

export function AssetDownloadButton({
  assetId,
  assetType = "photo",
  sequenceKind = null,
  hasSrt,
  hasLrf,
  hasProxy,
  hasFullResExport = false,
  hasPanoPreview = false,
  className,
}: {
  assetId: string;
  assetType?: "photo" | "video" | "sequence";
  sequenceKind?: "hyperlapse" | "panorama" | null;
  hasSrt: boolean;
  hasLrf: boolean;
  hasProxy: boolean;
  hasFullResExport?: boolean;
  hasPanoPreview?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [includeSrt, setIncludeSrt] = useState(false);
  const [includeLrf, setIncludeLrf] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (exportBusy) return;
      if (!panelRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !exportBusy) setOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, exportBusy]);

  function downloadHref(
    source: "original" | "proxy" | "frames" | "fullres" | "pano",
  ) {
    const params = new URLSearchParams();
    if (includeSrt) params.set("srt", "1");
    if (includeLrf) params.set("lrf", "1");
    params.set("source", source);
    return `/api/assets/${assetId}/download?${params.toString()}`;
  }

  const isPanorama = sequenceKind === "panorama";

  function triggerBrowserDownload(url: string) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function downloadFullResMp4() {
    setExportBusy(true);
    setExportMessage("Preparing full-resolution MP4…");
    try {
      const url = `/api/assets/${assetId}/download?source=fullres`;
      for (let attempt = 0; attempt < 120; attempt++) {
        const response = await fetch(url);
        if (response.status === 202) {
          setExportMessage("Preparing full-resolution MP4…");
          await new Promise((resolve) => setTimeout(resolve, 2500));
          continue;
        }
        if (!response.ok) throw new Error("Export failed");
        triggerBrowserDownload(url);
        setExportMessage(null);
        setOpen(false);
        return;
      }
      setExportMessage("Still preparing — try again in a moment.");
    } catch {
      setExportMessage("Could not prepare the MP4 export.");
    } finally {
      setExportBusy(false);
    }
  }

  const hasSidecars = hasSrt || hasLrf;
  const showProxyOption =
    assetType === "video" && (hasProxy || hasLrf);
  const needsPanel = hasSidecars || showProxyOption;

  if (assetType === "sequence") {
    return (
      <div ref={panelRef} className={cn("relative", className)}>
        <button
          type="button"
          aria-label={isPanorama ? "Download panorama" : "Download sequence"}
          title={isPanorama ? "Download panorama" : "Download sequence"}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex size-10 items-center justify-center rounded-full bg-black/55 text-white shadow-md backdrop-blur-sm transition hover:bg-black/75"
        >
          <Download className="size-5" />
        </button>

        {open ? (
          <div className="absolute right-0 top-12 z-50 w-72 max-w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-white/10 bg-zinc-950/95 p-3 text-sm text-white shadow-xl backdrop-blur-md">
            <p className="mb-2 text-xs font-medium text-zinc-300">
              {isPanorama ? "Download panorama" : "Download sequence"}
            </p>
            <a
              href={downloadHref("frames")}
              download
              onClick={() => setOpen(false)}
              className="mb-2 inline-flex h-8 w-full items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80"
            >
              {isPanorama ? "Original tiles (zip)" : "Original frames (zip)"}
            </a>
            {isPanorama ? (
              <a
                href={downloadHref("pano")}
                download
                onClick={() => setOpen(false)}
                className={cn(
                  "inline-flex h-8 w-full items-center justify-center rounded-lg border border-white/15 px-3 text-sm font-medium hover:bg-white/10",
                  !hasPanoPreview && "pointer-events-none opacity-50",
                )}
              >
                {hasPanoPreview
                  ? "Stitched preview (JPEG)"
                  : "Stitched preview (not ready)"}
              </a>
            ) : (
              <button
                type="button"
                disabled={exportBusy}
                onClick={() => void downloadFullResMp4()}
                className="inline-flex h-8 w-full items-center justify-center rounded-lg border border-white/15 px-3 text-sm font-medium hover:bg-white/10 disabled:opacity-60"
              >
                {exportBusy
                  ? "Preparing…"
                  : hasFullResExport
                    ? "Full-resolution MP4"
                    : "Full-resolution MP4 (prepare)"}
              </button>
            )}
            {exportMessage ? (
              <p className="mt-2 break-words text-[11px] leading-snug text-zinc-400">
                {exportMessage}
              </p>
            ) : (
              <p className="mt-2 break-words text-[11px] leading-snug text-zinc-500">
                {isPanorama
                  ? "Keep original DJI tiles, or download the stitched preview used in the 360° viewer."
                  : "Playback uses a compressed proxy. Downloads keep JPEG originals or a high-quality source-resolution MP4."}
              </p>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  if (!needsPanel) {
    return (
      <a
        href={downloadHref("original")}
        download
        aria-label="Download original"
        title="Download original"
        className={cn(
          "inline-flex size-10 items-center justify-center rounded-full bg-black/55 text-white shadow-md backdrop-blur-sm transition hover:bg-black/75",
          className,
        )}
      >
        <Download className="size-5" />
      </a>
    );
  }

  return (
    <div ref={panelRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-label="Download"
        title="Download"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex size-10 items-center justify-center rounded-full bg-black/55 text-white shadow-md backdrop-blur-sm transition hover:bg-black/75"
      >
        <Download className="size-5" />
      </button>

      {open ? (
        <div className="absolute right-0 top-12 z-50 w-72 max-w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-white/10 bg-zinc-950/95 p-3 text-sm text-white shadow-xl backdrop-blur-md">
          <p className="mb-2 text-xs font-medium text-zinc-300">Download</p>

          <div className="mb-3 space-y-2">
            <a
              href={downloadHref("original")}
              download
              onClick={() => {
                if (!exportBusy) setOpen(false);
              }}
              className="inline-flex h-8 w-full items-center justify-center rounded-lg border border-white/15 px-3 text-sm font-medium hover:bg-white/10"
            >
              Original (full resolution)
            </a>

            {showProxyOption ? (
              <a
                href={downloadHref("proxy")}
                download
                onClick={() => {
                  if (!exportBusy) setOpen(false);
                }}
                className="inline-flex h-8 w-full items-center justify-center rounded-lg border border-white/15 px-3 text-xs font-medium text-zinc-300 hover:bg-white/10"
              >
                Proxy / LRF (smaller preview)
              </a>
            ) : null}
          </div>

          {hasSidecars ? (
            <>
              <p className="mb-2 text-xs font-medium text-zinc-300">
                Include with original
              </p>
              <label className="mb-2 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={includeSrt}
                  disabled={!hasSrt || exportBusy}
                  onChange={(event) => setIncludeSrt(event.target.checked)}
                />
                Include SRT telemetry
                {!hasSrt ? (
                  <span className="text-zinc-500">(none)</span>
                ) : null}
              </label>
              <label className="mb-3 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={includeLrf}
                  disabled={!hasLrf || exportBusy}
                  onChange={(event) => setIncludeLrf(event.target.checked)}
                />
                Include LRF preview file
                {!hasLrf ? (
                  <span className="text-zinc-500">(none)</span>
                ) : null}
              </label>
              {includeSrt || includeLrf ? (
                <a
                  href={downloadHref("original")}
                  download
                  onClick={() => {
                    if (!exportBusy) setOpen(false);
                  }}
                  className="mb-2 inline-flex h-8 w-full items-center justify-center rounded-lg border border-white/15 px-3 text-sm font-medium hover:bg-white/10"
                >
                  Download original zip
                </a>
              ) : null}
            </>
          ) : null}

          {exportMessage ? (
            <p className="mt-2 break-words text-[11px] leading-snug text-zinc-400">
              {exportMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
