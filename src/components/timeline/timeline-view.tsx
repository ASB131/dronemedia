"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CheckSquare,
  Download,
  Film,
  Globe2,
  Heart,
  ImageIcon,
  Images,
  Square,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { MediaGridSkeleton } from "@/components/ui/skeletons";
import type {
  OnThisDayGroupDto,
  TimelineAssetDto,
  TimelineMediaTypeFilter,
  TimelineResponse,
  TimelineSectionDto,
} from "@/lib/assets/timeline";
import { buildTimelineVirtualItems } from "@/lib/assets/timeline-virtual";
import { assetThumbnailSrc } from "@/lib/assets/thumbnails";
import type { AlbumSummaryDto } from "@/lib/albums/queries";
import {
  clearTimelineScrollPosition,
  peekTimelineScrollPosition,
  saveTimelineScrollPosition,
} from "@/lib/navigation/media-return";
import { cn } from "@/lib/utils";

const VIDEO_HOVER_PREVIEW_MS = 1000;

/** Match Tailwind breakpoints used by the timeline asset grids. */
function timelineColumnCount(width: number) {
  if (width >= 1536) return 7;
  if (width >= 1280) return 6;
  if (width >= 1024) return 5;
  if (width >= 768) return 4;
  if (width >= 640) return 3;
  return 2;
}

function AssetTile({
  asset,
  selected,
  selectMode,
  onToggle,
  onQuickSelect,
  onOpen,
}: {
  asset: TimelineAssetDto;
  selected: boolean;
  selectMode: boolean;
  onToggle: (shiftKey: boolean) => void;
  onQuickSelect: (shiftKey: boolean) => void;
  onOpen?: () => void;
}) {
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [previewArmed, setPreviewArmed] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aspectRatio = asset.aspectRatio > 0 ? asset.aspectRatio : 16 / 9;
  const showCheck = selectMode || selected;
  const canHoverPreview = asset.assetType === "video";

  useEffect(() => {
    setThumbLoaded(false);
    setThumbFailed(false);
    setPreviewArmed(false);
    setPreviewReady(false);
    if (previewTimer.current) {
      clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
  }, [asset.id]);

  useEffect(() => {
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, []);

  function armHoverPreview() {
    if (!canHoverPreview) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      setPreviewArmed(true);
    }, VIDEO_HOVER_PREVIEW_MS);
  }

  function disarmHoverPreview() {
    if (previewTimer.current) {
      clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
    setPreviewArmed(false);
    setPreviewReady(false);
  }

  const checkControl = (
    <button
      type="button"
      aria-label={selected ? "Deselect" : "Select"}
      title={selected ? "Deselect" : "Select"}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onQuickSelect(event.shiftKey);
      }}
      className={cn(
        "absolute left-1 top-1 z-10 inline-flex size-6 items-center justify-center rounded border shadow-sm transition",
        selected
          ? "border-primary bg-primary text-primary-foreground opacity-100"
          : "border-white/85 bg-black/45 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        showCheck && !selected && "opacity-100",
      )}
    >
      {selected ? (
        <CheckSquare className="size-3.5" />
      ) : (
        <Square className="size-3.5" />
      )}
    </button>
  );

  const content = (
    <>
      {thumbFailed ? (
        <div className="flex size-full items-center justify-center bg-muted text-xs text-muted-foreground">
          …
        </div>
      ) : (
        <>
          {!thumbLoaded ? (
            <div
              className="absolute inset-0 animate-pulse bg-muted"
              aria-hidden
            />
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assetThumbnailSrc(asset.id, asset.updatedAt)}
            alt=""
            className={cn(
              "relative size-full object-cover transition duration-500 group-hover:brightness-75",
              "opacity-0 transition-opacity duration-500 ease-out",
              thumbLoaded && "opacity-100",
              previewReady && "opacity-0 group-hover:brightness-100",
            )}
            loading="lazy"
            decoding="async"
            onLoad={() => setThumbLoaded(true)}
            onError={() => setThumbFailed(true)}
          />
        </>
      )}

      {previewArmed ? (
        <video
          key={asset.id}
          src={`/api/assets/${asset.id}/original`}
          muted
          loop
          playsInline
          preload="auto"
          className={cn(
            "pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-500",
            previewReady ? "opacity-100" : "opacity-0",
          )}
          onLoadedData={(event) => {
            setPreviewReady(true);
            void event.currentTarget.play().catch(() => {
              setPreviewArmed(false);
              setPreviewReady(false);
            });
          }}
          onError={() => {
            setPreviewArmed(false);
            setPreviewReady(false);
          }}
        />
      ) : null}

      <span className="pointer-events-none absolute bottom-1 left-1 z-[1] inline-flex items-center gap-0.5 rounded bg-black/55 px-1 py-0.5 text-[10px] text-white shadow-sm">
        {asset.panoramaBadge ? (
          <span aria-label={asset.panoramaBadge}>{asset.panoramaBadge}</span>
        ) : asset.assetType === "video" ? (
          <Film className="size-3" aria-label="Video" />
        ) : asset.assetType === "sequence" ? (
          <>
            <Images className="size-3" aria-label="Sequence" />
            {asset.frameCount ? (
              <span className="tabular-nums">{asset.frameCount}</span>
            ) : null}
          </>
        ) : (
          <ImageIcon className="size-3" aria-label="Photo" />
        )}
      </span>

      <span className="absolute right-1 top-1 z-[1] inline-flex items-center gap-0.5">
        {asset.isPublic ? (
          <Globe2 className="size-3.5 text-sky-300 drop-shadow" aria-label="Public" />
        ) : null}
        {asset.favorite ? (
          <Heart className="size-3.5 fill-[#ed79b5] text-[#ed79b5] drop-shadow" />
        ) : null}
      </span>

      {checkControl}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] translate-y-1 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-1.5 pb-1.5 pt-6 opacity-0 transition duration-150 group-hover:translate-y-0 group-hover:opacity-100">
        <p className="truncate text-[11px] font-medium text-white">
          {asset.displayName}
        </p>
      </div>
    </>
  );

  const tileClass = cn(
    "dm-media-tile group relative block w-full overflow-hidden rounded-md bg-muted/40",
    selected && "ring-2 ring-primary",
  );
  const tileStyle = { aspectRatio: String(aspectRatio) };

  if (selectMode) {
    return (
      <button
        type="button"
        onClick={(event) => onToggle(event.shiftKey)}
        onMouseEnter={armHoverPreview}
        onMouseLeave={disarmHoverPreview}
        className={tileClass}
        style={tileStyle}
      >
        {content}
      </button>
    );
  }

  return (
    <Link
      href={`/assets/${asset.id}`}
      className={tileClass}
      style={tileStyle}
      onClick={() => onOpen?.()}
      onMouseEnter={armHoverPreview}
      onMouseLeave={disarmHoverPreview}
    >
      {content}
    </Link>
  );
}

function OnThisDayPanel({
  groups,
  onOpen,
}: {
  groups: OnThisDayGroupDto[];
  onOpen?: (assetId: string) => void;
}) {
  if (groups.length === 0) return null;

  const total = groups.reduce((sum, group) => sum + group.assets.length, 0);

  return (
    <section className="mb-6 rounded-xl border border-border/80 bg-muted/20 px-3 py-3 sm:px-4">
      <h2 className="text-sm font-semibold">On this day</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {total} item{total === 1 ? "" : "s"} from this date in prior years
      </p>
      <div className="mt-3 space-y-4">
        {groups.map((group) => (
          <div key={group.year}>
            <p className="mb-2 text-xs font-medium text-primary">
              {group.label}
              <span className="ml-1.5 font-normal text-muted-foreground">
                · {group.year}
              </span>
            </p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {group.assets.map((asset) => (
                <AssetTile
                  key={asset.id}
                  asset={asset}
                  selected={false}
                  selectMode={false}
                  onToggle={() => undefined}
                  onQuickSelect={() => undefined}
                  onOpen={() => onOpen?.(asset.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function mergeTimelineSections(
  current: TimelineSectionDto[],
  incoming: TimelineSectionDto[],
) {
  const sections = new Map(
    current.map((section) => [
      section.key,
      {
        ...section,
        assets: [...section.assets],
      },
    ]),
  );

  for (const section of incoming) {
    const existing = sections.get(section.key);
    if (existing) {
      const seen = new Set(existing.assets.map((asset) => asset.id));
      for (const asset of section.assets) {
        if (seen.has(asset.id)) continue;
        seen.add(asset.id);
        existing.assets.push(asset);
      }
      existing.assets.sort(
        (a, b) =>
          new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
      );
    } else {
      sections.set(section.key, {
        ...section,
        assets: [...section.assets],
      });
    }
  }

  return [...sections.values()].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    if (a.month !== b.month) return b.month - a.month;
    return b.day - a.day;
  });
}

export function TimelineView({
  favoritesOnly = false,
}: {
  favoritesOnly?: boolean;
}) {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [albums, setAlbums] = useState<AlbumSummaryDto[]>([]);
  const [albumId, setAlbumId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [mediaType, setMediaType] =
    useState<TimelineMediaTypeFilter>("all");
  const [zipMultiSelectDefault, setZipMultiSelectDefault] = useState(true);
  const [stickyHeader, setStickyHeader] = useState<{
    year: number | null;
    monthLabel: string | null;
    dayLabel: string | null;
  }>({ year: null, monthLabel: null, dayLabel: null });
  const [scrubVisible, setScrubVisible] = useState(false);
  const [scrubLabel, setScrubLabel] = useState<{
    year: number | null;
    monthLabel: string | null;
  }>({ year: null, monthLabel: null });
  const scrubHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const inFlightCursorRef = useRef<string | null>(null);
  const [gridCols, setGridCols] = useState(5);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const update = () => {
      setGridCols(timelineColumnCount(el.clientWidth));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const loadTimeline = useCallback(async (cursor?: string) => {
    const searchParams = new URLSearchParams({ limit: "80" });
    if (favoritesOnly) searchParams.set("favorite", "true");
    if (mediaType !== "all") searchParams.set("type", mediaType);
    if (cursor) searchParams.set("cursor", cursor);
    const url = `/api/assets/timeline?${searchParams}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Failed to load timeline");
    }
    return (await response.json()) as TimelineResponse;
  }, [favoritesOnly, mediaType]);

  const reload = useCallback(async () => {
    try {
      setError(null);
      setData(await loadTimeline());
    } catch {
      setError("Failed to load timeline");
    }
  }, [loadTimeline]);

  const loadMore = useCallback(async () => {
    const cursor = data?.nextCursor;
    if (!cursor || loadingMoreRef.current || inFlightCursorRef.current === cursor) {
      return;
    }

    loadingMoreRef.current = true;
    inFlightCursorRef.current = cursor;
    setLoadingMore(true);
    try {
      const page = await loadTimeline(cursor);
      setData((current) => {
        if (!current) return page;
        return {
          ...page,
          onThisDay: current.onThisDay,
          sections: mergeTimelineSections(current.sections, page.sections),
        };
      });
    } catch {
      setError("Failed to load timeline");
    } finally {
      loadingMoreRef.current = false;
      inFlightCursorRef.current = null;
      setLoadingMore(false);
    }
  }, [data?.nextCursor, loadTimeline]);

  useEffect(() => {
    setSelected(new Set());
    setLastClickedId(null);
    void reload();
  }, [reload]);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/albums");
      if (!response.ok) return;
      const payload = (await response.json()) as { albums: AlbumSummaryDto[] };
      setAlbums(payload.albums);
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/account");
      if (!response.ok) return;
      const payload = (await response.json()) as {
        preferences?: { zipMultiSelectDefault?: boolean };
      };
      setZipMultiSelectDefault(
        payload.preferences?.zipMultiSelectDefault !== false,
      );
    })();
  }, []);

  const virtualItems = useMemo(
    () => buildTimelineVirtualItems(data?.sections ?? []),
    [data?.sections],
  );

  const visibleAssetIds = useMemo(() => {
    if (!data) return [] as string[];
    return data.sections.flatMap((section) =>
      section.assets.map((asset) => asset.id),
    );
  }, [data]);

  const rowVirtualizer = useVirtualizer({
    count: virtualItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const item = virtualItems[index];
      if (!item) return 80;
      if (item.type === "year") return 44;
      if (item.type === "month") return 32;
      const cols = Math.max(2, gridCols);
      const rows = Math.ceil(item.section.assets.length / cols);
      const width = parentRef.current?.clientWidth ?? 960;
      const gap = 4;
      const tile = Math.max(80, Math.floor((width - gap * (cols - 1)) / cols));
      return 40 + rows * (tile + gap);
    },
    overscan: 8,
  });

  // Re-measure when column count changes so scroll positions stay accurate.
  useEffect(() => {
    rowVirtualizer.measure();
  }, [gridCols, rowVirtualizer]);

  const scrubMarkers = useMemo(() => {
    const markers: Array<{
      index: number;
      year: number;
      monthLabel?: string;
      ratio: number;
    }> = [];
    const total = Math.max(1, virtualItems.length - 1);
    for (let i = 0; i < virtualItems.length; i += 1) {
      const item = virtualItems[i];
      if (!item) continue;
      if (item.type === "year") {
        markers.push({ index: i, year: item.year, ratio: i / total });
      } else if (item.type === "month") {
        markers.push({
          index: i,
          year: item.year,
          monthLabel: item.monthLabel,
          ratio: i / total,
        });
      }
    }
    return markers;
  }, [virtualItems]);

  useEffect(() => {
    if (!parentRef.current) return;
    const scrollElement = parentRef.current;

    function resolveSticky(index: number) {
      let year: number | null = null;
      let monthLabel: string | null = null;
      let dayLabel: string | null = null;
      for (let i = index; i >= 0; i -= 1) {
        const item = virtualItems[i];
        if (!item) continue;
        if (!dayLabel && item.type === "section") {
          dayLabel = item.section.dateLabel;
        }
        if (!monthLabel && (item.type === "month" || item.type === "section")) {
          monthLabel =
            item.type === "month"
              ? item.monthLabel
              : item.section.monthLabel;
        }
        if (!year) {
          if (item.type === "year") year = item.year;
          else if (item.type === "month") year = item.year;
          else year = item.section.year;
        }
        if (year && monthLabel && dayLabel) break;
      }
      setStickyHeader({ year, monthLabel, dayLabel });
      setScrubLabel({ year, monthLabel });
    }

    function onScroll() {
      const items = rowVirtualizer.getVirtualItems();
      const first = items[0];
      if (first) resolveSticky(first.index);
      if (
        scrollElement.scrollHeight -
          scrollElement.scrollTop -
          scrollElement.clientHeight <
        800
      ) {
        void loadMore();
      }
      setScrubVisible(true);
      if (scrubHideTimer.current) clearTimeout(scrubHideTimer.current);
      scrubHideTimer.current = setTimeout(() => setScrubVisible(false), 900);
    }

    scrollElement.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      scrollElement.removeEventListener("scroll", onScroll);
      if (scrubHideTimer.current) clearTimeout(scrubHideTimer.current);
    };
  }, [loadMore, rowVirtualizer, virtualItems]);

  function jumpToIndex(index: number) {
    rowVirtualizer.scrollToIndex(index, { align: "start" });
  }

  const rememberAssetOpen = useCallback(
    (assetId: string) => {
      const scrollTop = parentRef.current?.scrollTop ?? 0;
      saveTimelineScrollPosition({
        scrollTop,
        focusAssetId: assetId,
        favoritesOnly,
      });
    },
    [favoritesOnly],
  );

  const [pendingRestore] = useState(() =>
    peekTimelineScrollPosition(favoritesOnly),
  );
  const restoreDoneRef = useRef(false);

  useEffect(() => {
    if (!pendingRestore || restoreDoneRef.current || !data) return;

    const focusId = pendingRestore.focusAssetId;
    const sectionIndex = virtualItems.findIndex(
      (item) =>
        item.type === "section" &&
        item.section.assets.some((asset) => asset.id === focusId),
    );

    if (sectionIndex >= 0) {
      restoreDoneRef.current = true;
      clearTimelineScrollPosition(favoritesOnly);
      requestAnimationFrame(() => {
        rowVirtualizer.scrollToIndex(sectionIndex, { align: "center" });
      });
      return;
    }

    if (data.nextCursor && !loadingMore) {
      void loadMore();
      return;
    }

    // Asset not found (filtered out / deleted) — fall back to raw scroll.
    restoreDoneRef.current = true;
    clearTimelineScrollPosition(favoritesOnly);
    const el = parentRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTop = pendingRestore.scrollTop;
      });
    }
  }, [
    pendingRestore,
    data,
    virtualItems,
    loadingMore,
    loadMore,
    rowVirtualizer,
    favoritesOnly,
  ]);

  function toggle(id: string, shiftKey: boolean) {
    const anchorId = lastClickedId;
    setSelected((prev) => {
      const next = new Set(prev);

      if (shiftKey && anchorId) {
        const start = visibleAssetIds.indexOf(anchorId);
        const end = visibleAssetIds.indexOf(id);
        if (start !== -1 && end !== -1) {
          const [from, to] = start < end ? [start, end] : [end, start];
          for (let i = from; i <= to; i += 1) {
            const assetId = visibleAssetIds[i];
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
  }

  function quickSelect(id: string, shiftKey: boolean) {
    setSelectMode(true);
    toggle(id, shiftKey);
  }

  async function runBulk(
    action:
      | "favorite"
      | "unfavorite"
      | "bin"
      | "addToAlbum"
      | "makePublic"
      | "makePrivate",
  ) {
    if (selected.size === 0) return;
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/assets/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assetIds: [...selected],
        action,
        albumId: action === "addToAlbum" ? albumId : undefined,
      }),
    });
    setBusy(false);
    if (!response.ok) {
      setMessage("Bulk action failed");
      return;
    }
    setSelected(new Set());
    setSelectMode(false);
    setLastClickedId(null);
    setMessage("Done");
    await reload();
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void reload()}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="p-2" aria-busy aria-label="Loading timeline">
        <MediaGridSkeleton count={28} />
      </div>
    );
  }

  if (data.sections.length === 0 && data.onThisDay.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-lg font-medium">No media yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {favoritesOnly
            ? "Mark assets as favorites to see them here."
            : mediaType !== "all"
              ? "No media matches this filter."
              : "Upload drone photos and videos to populate your timeline."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <h1 className="mr-auto text-lg font-semibold">
          {favoritesOnly ? "Favorites" : "Photos / Videos"}
        </h1>
        <div className="flex overflow-hidden rounded-full border border-border text-xs">
          {(
            [
              ["all", "All"],
              ["photo", "Photos"],
              ["video", "Videos"],
              ["panorama", "Panos"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMediaType(value)}
              className={cn(
                "px-2.5 py-1.5",
                mediaType === value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant={selectMode ? "default" : "outline"}
          onClick={() => {
            setSelectMode((value) => !value);
            setSelected(new Set());
            setLastClickedId(null);
            setMessage(null);
          }}
        >
          {selectMode ? "Cancel" : "Select"}
        </Button>
      </div>

      {selectMode ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-2">
          <span className="text-xs text-muted-foreground">
            {selected.size} selected
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !data}
            onClick={() => {
              const ids = new Set<string>();
              for (const section of data?.sections ?? []) {
                for (const asset of section.assets) {
                  ids.add(asset.id);
                }
              }
              setSelected(ids);
            }}
          >
            Select all
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || selected.size === 0}
            onClick={() => {
              setSelected(new Set());
              setLastClickedId(null);
            }}
          >
            Unselect all
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || selected.size === 0}
            onClick={() => void runBulk("favorite")}
          >
            <Heart className="size-3.5" /> Favorite
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || selected.size === 0}
            onClick={() => void runBulk("unfavorite")}
          >
            Unfavorite
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || selected.size === 0}
            onClick={() => void runBulk("makePublic")}
          >
            <Globe2 className="size-3.5" /> Public
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || selected.size === 0}
            onClick={() => void runBulk("makePrivate")}
          >
            Private
          </Button>
          <select
            value={albumId}
            onChange={(event) => setAlbumId(event.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="">Album…</option>
            {albums.map((album) => (
              <option key={album.id} value={album.id}>
                {album.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || selected.size === 0 || !albumId}
            onClick={() => void runBulk("addToAlbum")}
          >
            Add to album
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || selected.size === 0}
            onClick={() => {
              void (async () => {
                setBusy(true);
                setMessage(null);
                const ids = [...selected];

                if (!zipMultiSelectDefault && ids.length > 1) {
                  for (const assetId of ids) {
                    const anchor = document.createElement("a");
                    anchor.href = `/api/assets/${assetId}/download`;
                    anchor.download = "";
                    anchor.click();
                    await new Promise((resolve) => setTimeout(resolve, 250));
                  }
                  setBusy(false);
                  setMessage("Downloads started");
                  return;
                }

                const response = await fetch("/api/assets/zip", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ assetIds: ids }),
                });
                setBusy(false);
                if (!response.ok) {
                  setMessage("Zip failed");
                  return;
                }
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = "drone-media-export.zip";
                anchor.click();
                URL.revokeObjectURL(url);
                setMessage("Download started");
              })();
            }}
          >
            <Download className="size-3.5" />{" "}
            {zipMultiSelectDefault || selected.size <= 1 ? "Zip" : "Download"}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy || selected.size === 0}
            onClick={() => {
              if (!confirm(`Move ${selected.size} asset(s) to bin?`)) return;
              void runBulk("bin");
            }}
          >
            <Trash2 className="size-3.5" /> Bin
          </Button>
          {message ? (
            <span className="text-xs text-muted-foreground">{message}</span>
          ) : null}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {(stickyHeader.year ||
          stickyHeader.monthLabel ||
          stickyHeader.dayLabel) && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 border-b border-border/70 bg-background/95 px-3 py-2 backdrop-blur-md">
            {stickyHeader.year ? (
              <p className="text-2xl font-semibold tracking-tight">
                {stickyHeader.year}
              </p>
            ) : null}
            {stickyHeader.monthLabel ? (
              <p className="text-sm font-medium text-primary">
                {stickyHeader.monthLabel}
              </p>
            ) : null}
            {stickyHeader.dayLabel ? (
              <p className="text-xs text-muted-foreground">
                {stickyHeader.dayLabel}
              </p>
            ) : null}
          </div>
        )}

        <div
          ref={parentRef}
          className="dm-scrollbar absolute inset-0 overflow-auto px-3 py-3 pr-8 pt-16"
        >
          <OnThisDayPanel
            groups={data.onThisDay}
            onOpen={rememberAssetOpen}
          />

          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const item = virtualItems[virtualRow.index];
              if (!item) return null;

              return (
                <div
                  key={item.key}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {item.type === "year" ? (
                    <h2 className="px-1 pb-1 pt-3 text-xl font-semibold tracking-tight text-muted-foreground/80">
                      {item.year}
                    </h2>
                  ) : null}
                  {item.type === "month" ? (
                    <h3 className="px-1 pb-1 pt-2 text-sm font-medium text-primary/80">
                      {item.monthLabel}
                    </h3>
                  ) : null}
                  {item.type === "section" ? (
                    <section className="pb-5">
                      <p className="mb-2.5 text-sm font-semibold text-foreground/90">
                        {item.section.dateLabel}
                      </p>
                      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
                        {item.section.assets.map((asset) => (
                          <AssetTile
                            key={asset.id}
                            asset={asset}
                            selectMode={selectMode}
                            selected={selected.has(asset.id)}
                            onToggle={(shiftKey) => toggle(asset.id, shiftKey)}
                            onQuickSelect={(shiftKey) =>
                              quickSelect(asset.id, shiftKey)
                            }
                            onOpen={() => rememberAssetOpen(asset.id)}
                          />
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              );
            })}
          </div>
          {data.nextCursor ? (
            <div className="flex justify-center py-4">
              <Button
                variant="outline"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </div>

        {scrubMarkers.length > 0 ? (
          <div
            className={cn(
              "pointer-events-none absolute inset-y-3 right-1 z-30 flex w-10 flex-col items-end transition-opacity duration-200",
              scrubVisible ? "opacity-100" : "opacity-40",
            )}
            aria-hidden={false}
          >
            <div className="relative h-full w-full">
              {scrubVisible && scrubLabel.year ? (
                <div className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-lg bg-primary px-2.5 py-1.5 text-right text-primary-foreground shadow-md">
                  <p className="text-sm font-semibold leading-none">
                    {scrubLabel.year}
                  </p>
                  {scrubLabel.monthLabel ? (
                    <p className="mt-1 text-[10px] leading-none opacity-90">
                      {scrubLabel.monthLabel}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="pointer-events-auto absolute inset-y-0 right-0 w-6">
                {scrubMarkers
                  .filter((marker) => !marker.monthLabel)
                  .map((marker) => (
                    <button
                      key={`y-${marker.index}`}
                      type="button"
                      title={String(marker.year)}
                      className="absolute right-0 -translate-y-1/2 text-[10px] font-semibold text-muted-foreground hover:text-primary"
                      style={{ top: `${marker.ratio * 100}%` }}
                      onClick={() => jumpToIndex(marker.index)}
                    >
                      {marker.year}
                    </button>
                  ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
