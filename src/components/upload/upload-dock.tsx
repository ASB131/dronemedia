"use client";

import Link from "next/link";
import { useEffect } from "react";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Pause,
  Play,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  formatEtaSeconds,
  formatUploadBytes,
} from "@/lib/upload/client";
import { cn } from "@/lib/utils";
import {
  hasActiveUploadFiles,
  isUploadActive,
  useUploadStore,
} from "@/stores/upload-store";

function statusLabel(status: string) {
  switch (status) {
    case "queued":
      return "Queued";
    case "uploading":
      return "Uploading";
    case "assembling":
      return "Assembling";
    case "complete":
      return "Ready";
    case "committed":
      return "Done";
    case "error":
      return "Failed";
    default:
      return status;
  }
}

export function UploadDock() {
  const batch = useUploadStore((s) => s.batch);
  const pendingFiles = useUploadStore((s) => s.pendingFiles);
  const stats = useUploadStore((s) => s.stats);
  const dockExpanded = useUploadStore((s) => s.dockExpanded);
  const dockDismissed = useUploadStore((s) => s.dockDismissed);
  const softPaused = useUploadStore((s) => s.softPaused);
  const waveInfo = useUploadStore((s) => s.waveInfo);
  const notice = useUploadStore((s) => s.notice);
  const setDockExpanded = useUploadStore((s) => s.setDockExpanded);
  const setDockDismissed = useUploadStore((s) => s.setDockDismissed);
  const setSoftPaused = useUploadStore((s) => s.setSoftPaused);
  const clearCompleted = useUploadStore((s) => s.clearCompleted);
  const cancelActive = useUploadStore((s) => s.cancelActive);
  const reset = useUploadStore((s) => s.reset);

  const active =
    isUploadActive(batch.status) ||
    hasActiveUploadFiles(batch.files) ||
    pendingFiles.length > 0;
  const visible =
    !dockDismissed &&
    (batch.status !== "idle" || pendingFiles.length > 0 || Boolean(notice));

  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);

  if (!visible) return null;

  const overallPct =
    stats.bytesTotal > 0
      ? Math.round((stats.bytesUploaded / stats.bytesTotal) * 100)
      : batch.files.length > 0
        ? Math.round(
            (batch.files.reduce((sum, file) => sum + file.progress, 0) /
              batch.files.length) *
              100,
          )
        : 0;

  const failed = batch.files.filter((file) => file.status === "error");
  const title =
    batch.status === "committing"
      ? "Finishing upload…"
      : softPaused
        ? "Upload paused"
        : active
          ? "Uploading"
          : batch.status === "done"
            ? failed.length > 0
              ? "Upload finished with errors"
              : "Upload complete"
            : batch.status === "error"
              ? "Upload failed"
              : "Upload queue";

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(100vw-2rem,22rem)] flex-col items-stretch gap-2">
      <div className="pointer-events-auto overflow-hidden rounded-xl border border-border bg-background/95 shadow-lg backdrop-blur">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            {active && !softPaused ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {waveInfo
                ? `Wave ${waveInfo.waveNumber}${
                    waveInfo.pendingCount > 0
                      ? ` · ${waveInfo.pendingCount} waiting`
                      : ""
                  } · `
                : ""}
              {formatUploadBytes(stats.bytesUploaded)} /{" "}
              {formatUploadBytes(stats.bytesTotal)}
              {stats.bytesPerSecond > 0
                ? ` · ${formatUploadBytes(stats.bytesPerSecond)}/s`
                : ""}
              {active ? ` · ETA ${formatEtaSeconds(stats.etaSeconds)}` : ""}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={dockExpanded ? "Collapse upload dock" : "Expand upload dock"}
            onClick={() => setDockExpanded(!dockExpanded)}
          >
            {dockExpanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronUp className="size-4" />
            )}
          </Button>
          {!active ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Dismiss upload dock"
              onClick={() => {
                clearCompleted();
                setDockDismissed(true);
              }}
            >
              <X className="size-4" />
            </Button>
          ) : null}
        </div>

        <div className="h-1 bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${overallPct}%` }}
          />
        </div>

        {dockExpanded ? (
          <div className="max-h-72 space-y-2 overflow-auto p-3">
            {notice ? (
              <p className="rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                {notice}
              </p>
            ) : null}
            {batch.error ? (
              <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                {batch.error}
              </p>
            ) : null}
            {batch.files.map((file) => (
              <div
                key={file.localId}
                className="rounded-lg border border-border/80 px-2.5 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">
                      {file.file.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatUploadBytes(file.file.size)} ·{" "}
                      {statusLabel(file.status)}
                    </p>
                    {file.error ? (
                      <p className="mt-0.5 text-[11px] text-destructive">
                        {file.error}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {Math.round(file.progress * 100)}%
                  </span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      file.status === "error" ? "bg-destructive" : "bg-primary",
                    )}
                    style={{ width: `${Math.round(file.progress * 100)}%` }}
                  />
                </div>
              </div>
            ))}
            {pendingFiles.length > 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {pendingFiles.length} more file
                {pendingFiles.length === 1 ? "" : "s"} queued for later waves
              </p>
            ) : null}

            <div className="flex flex-wrap gap-1.5 pt-1">
              {active ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setSoftPaused(!softPaused)}
                  >
                    {softPaused ? (
                      <>
                        <Play className="size-3.5" />
                        Resume
                      </>
                    ) : (
                      <>
                        <Pause className="size-3.5" />
                        Pause
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => cancelActive()}
                  >
                    Cancel current
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => reset()}
                >
                  Clear
                </Button>
              )}
              <Link
                href="/upload"
                className="inline-flex h-8 items-center justify-center rounded-lg px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Go to Upload
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
