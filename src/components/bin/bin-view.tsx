"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CheckSquare,
  Film,
  ImageIcon,
  RotateCcw,
  Square,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { BinAssetDto } from "@/lib/assets/bin";
import { cn } from "@/lib/utils";

type TypeFilter = "all" | "photo" | "video";

function formatWhen(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
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

function Thumb({
  assetId,
  className,
}: {
  assetId: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={cn(
          "flex size-full items-center justify-center bg-muted text-muted-foreground",
          className,
        )}
      >
        <ImageIcon className="size-8 opacity-50" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/assets/${assetId}/thumbnail`}
      alt=""
      className={cn("size-full object-cover", className)}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function BinView() {
  const [items, setItems] = useState<BinAssetDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  async function reload() {
    const response = await fetch("/api/bin");
    if (!response.ok) {
      setError("Failed to load bin");
      return;
    }
    const payload = (await response.json()) as { items: BinAssetDto[] };
    setItems(payload.items);
    setError(null);
  }

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      const response = await fetch("/api/bin");
      if (!response.ok) {
        if (mounted) {
          setError("Failed to load bin");
          setLoading(false);
        }
        return;
      }
      const payload = (await response.json()) as { items: BinAssetDto[] };
      if (mounted) {
        setItems(payload.items);
        setLoading(false);
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (typeFilter === "all") return items;
    return items.filter((item) => item.assetType === typeFilter);
  }, [items, typeFilter]);

  const visibleIds = useMemo(() => filtered.map((item) => item.id), [filtered]);

  const preview = useMemo(
    () => items.find((item) => item.id === previewId) ?? null,
    [items, previewId],
  );

  const photoCount = items.filter((item) => item.assetType === "photo").length;
  const videoCount = items.filter((item) => item.assetType === "video").length;
  const selectedCount = selected.size;

  function clearSelection() {
    setSelected(new Set());
    setLastClickedId(null);
  }

  function toggleSelectMode() {
    setSelectMode((prev) => {
      if (prev) clearSelection();
      return !prev;
    });
  }

  function toggle(id: string, shiftKey: boolean) {
    const anchorId = lastClickedId;
    setSelected((prev) => {
      const next = new Set(prev);

      if (shiftKey && anchorId) {
        const start = visibleIds.indexOf(anchorId);
        const end = visibleIds.indexOf(id);
        if (start !== -1 && end !== -1) {
          const [from, to] = start < end ? [start, end] : [end, start];
          for (let i = from; i <= to; i += 1) {
            const assetId = visibleIds[i];
            if (assetId) next.add(assetId);
          }
          return next;
        }
      }

      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastClickedId(id);
    if (!selectMode) setSelectMode(true);
  }

  function selectAllVisible() {
    setSelected(new Set(visibleIds));
    setSelectMode(true);
  }

  async function restoreIds(assetIds: string[]) {
    if (assetIds.length === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const response = await fetch("/api/bin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds }),
    });
    setBusy(false);
    if (!response.ok) {
      setError("Failed to restore");
      return;
    }
    setMessage(
      `Restored ${assetIds.length} item${assetIds.length === 1 ? "" : "s"}`,
    );
    clearSelection();
    setSelectMode(false);
    if (previewId && assetIds.includes(previewId)) setPreviewId(null);
    await reload();
  }

  async function purgeIds(assetIds: string[]) {
    if (assetIds.length === 0) return;
    const label =
      assetIds.length === 1
        ? "Permanently delete this item? This cannot be undone."
        : `Permanently delete ${assetIds.length} items? This cannot be undone.`;
    if (!confirm(label)) return;

    setBusy(true);
    setError(null);
    setMessage(null);
    const response = await fetch("/api/bin", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds }),
    });
    setBusy(false);
    if (!response.ok) {
      setError("Failed to permanently delete");
      return;
    }
    setMessage(
      `Deleted ${assetIds.length} item${assetIds.length === 1 ? "" : "s"} forever`,
    );
    clearSelection();
    setSelectMode(false);
    if (previewId && assetIds.includes(previewId)) setPreviewId(null);
    window.dispatchEvent(new Event("dm-storage-changed"));
    await reload();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Bin</h1>
            <p className="text-xs text-muted-foreground">
              Review deleted media before permanent removal
              {items.length > 0
                ? ` · ${items.length} item${items.length === 1 ? "" : "s"}`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={selectMode ? "default" : "outline"}
              disabled={items.length === 0}
              onClick={toggleSelectMode}
            >
              {selectMode ? (
                <CheckSquare className="size-4" />
              ) : (
                <Square className="size-4" />
              )}
              {selectMode ? "Selecting" : "Select"}
            </Button>
            {selectMode ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={visibleIds.length === 0}
                  onClick={selectAllVisible}
                >
                  Select all
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={selectedCount === 0}
                  onClick={clearSelection}
                >
                  Clear
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {items.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {(
              [
                { id: "all", label: `All (${items.length})` },
                { id: "photo", label: `Photos (${photoCount})` },
                { id: "video", label: `Videos (${videoCount})` },
              ] as const
            ).map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTypeFilter(entry.id)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition",
                  typeFilter === entry.id
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {selectedCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
          <p className="text-sm font-medium">
            {selectedCount} selected
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void restoreIds([...selected])}
            >
              <RotateCcw className="size-4" />
              Restore
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => void purgeIds([...selected])}
            >
              <Trash2 className="size-4" />
              Delete forever
            </Button>
          </div>
        </div>
      ) : null}

      {(error || message) && (
        <div className="border-b border-border px-4 py-2">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{message}</p>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto p-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading bin…</p>
          ) : filtered.length === 0 ? (
            <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 text-center">
              <Trash2 className="size-8 text-muted-foreground/60" />
              <p className="text-sm font-medium">
                {items.length === 0 ? "Bin is empty" : "No items in this filter"}
              </p>
              <p className="text-xs text-muted-foreground">
                {items.length === 0
                  ? "Deleted photos and videos will appear here with previews."
                  : "Try another filter or clear selection mode."}
              </p>
              {items.length === 0 ? (
                <Link
                  href="/"
                  className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  Back to timeline
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {filtered.map((item) => {
                const isSelected = selected.has(item.id);
                const isPreview = previewId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={(event) => {
                      if (selectMode || event.shiftKey || event.metaKey || event.ctrlKey) {
                        toggle(item.id, event.shiftKey);
                        return;
                      }
                      setPreviewId(item.id);
                    }}
                    className={cn(
                      "group relative overflow-hidden rounded-xl border bg-card text-left transition",
                      isSelected
                        ? "border-primary ring-2 ring-primary/30"
                        : isPreview
                          ? "border-foreground/40 ring-2 ring-foreground/15"
                          : "border-border hover:border-foreground/25",
                    )}
                  >
                    <div className="relative aspect-square bg-muted">
                      <Thumb assetId={item.id} />
                      <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
                        {item.assetType === "video" ? (
                          <Film className="size-3" />
                        ) : (
                          <ImageIcon className="size-3" />
                        )}
                        {item.mainFileExt.toUpperCase()}
                      </span>
                      {(selectMode || isSelected) && (
                        <span
                          className={cn(
                            "absolute left-1.5 top-1.5 inline-flex size-5 items-center justify-center rounded border",
                            isSelected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-white/80 bg-black/40 text-white",
                          )}
                        >
                          {isSelected ? (
                            <CheckSquare className="size-3.5" />
                          ) : (
                            <Square className="size-3.5" />
                          )}
                        </span>
                      )}
                    </div>
                    <div className="space-y-0.5 p-2.5">
                      <p className="truncate text-sm font-medium">
                        {item.displayName}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        Deleted {formatWhen(item.deletedAt)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {preview ? (
          <aside className="hidden w-[min(22rem,40%)] shrink-0 flex-col border-l border-border bg-card md:flex">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {preview.displayName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {preview.assetType === "video" ? "Video" : "Photo"}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPreviewId(null)}
                aria-label="Close preview"
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              <div className="overflow-hidden rounded-xl border border-border bg-muted">
                <div className="aspect-[4/3]">
                  <Thumb assetId={preview.id} />
                </div>
              </div>

              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Size</dt>
                  <dd className="font-medium">
                    {formatBytes(preview.fileSizeBytes)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Captured</dt>
                  <dd className="text-right font-medium">
                    {formatWhen(preview.capturedAt)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Deleted</dt>
                  <dd className="text-right font-medium">
                    {formatWhen(preview.deletedAt)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Type</dt>
                  <dd className="font-medium">
                    {preview.mainFileExt.toUpperCase()}
                  </dd>
                </div>
              </dl>

              <div className="mt-5 flex flex-col gap-2">
                <Button
                  disabled={busy}
                  onClick={() => void restoreIds([preview.id])}
                >
                  <RotateCcw className="size-4" />
                  Restore
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void purgeIds([preview.id])}
                >
                  <Trash2 className="size-4" />
                  Delete forever
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => toggle(preview.id, false)}
                >
                  {selected.has(preview.id) ? "Deselect" : "Add to selection"}
                </Button>
              </div>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
