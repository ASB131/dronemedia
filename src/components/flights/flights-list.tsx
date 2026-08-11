"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LayoutGrid, Map as MapIcon, MapPin, Plane, X } from "lucide-react";

import {
  FlightsMapView,
  type FlightsMapCamera,
} from "@/components/flights/flights-map-view";
import { MediaGridSkeleton } from "@/components/ui/skeletons";
import type { FlightSummaryDto } from "@/lib/flights/queries";
import {
  peekFlightsViewState,
  saveFlightsViewState,
} from "@/lib/navigation/media-return";
import { cn } from "@/lib/utils";

type ViewMode = "list" | "map";

function formatWhen(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDuration(seconds: number | null) {
  if (seconds == null) return null;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

function groupByYear(flights: FlightSummaryDto[]) {
  const groups = new Map<string, FlightSummaryDto[]>();
  for (const flight of flights) {
    const year = flight.startTime
      ? String(new Date(flight.startTime).getFullYear())
      : "Unknown";
    const list = groups.get(year) ?? [];
    list.push(flight);
    groups.set(year, list);
  }
  return [...groups.entries()];
}

function FilterPill({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition",
        active
          ? "bg-foreground text-background"
          : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-12 shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </div>
  );
}

export function FlightsList() {
  const restored = useMemo(() => peekFlightsViewState(), []);
  const [flights, setFlights] = useState<FlightSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>(restored?.view ?? "list");
  const [yearFilter, setYearFilter] = useState(restored?.yearFilter ?? "all");
  const [mapCamera, setMapCamera] = useState<FlightsMapCamera | null>(
    restored?.map ?? null,
  );
  const listScrollRef = useRef<HTMLDivElement>(null);
  const mapCameraRef = useRef<FlightsMapCamera | null>(restored?.map ?? null);
  const restoredScrollRef = useRef(restored?.listScrollTop ?? null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      const response = await fetch("/api/flights");
      if (!response.ok) {
        if (mounted) {
          setError("Failed to load flights");
          setLoading(false);
        }
        return;
      }
      const payload = (await response.json()) as { flights: FlightSummaryDto[] };
      if (mounted) {
        setFlights(payload.flights);
        setError(null);
        setLoading(false);
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (view !== "list") return;
    const top = restoredScrollRef.current;
    if (top == null) return;
    const frame = requestAnimationFrame(() => {
      if (listScrollRef.current) {
        listScrollRef.current.scrollTop = top;
        restoredScrollRef.current = null;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [view, loading, flights.length]);

  const years = useMemo(() => {
    const set = new Set<string>();
    for (const flight of flights) {
      if (flight.startTime) {
        set.add(String(new Date(flight.startTime).getFullYear()));
      }
    }
    return [...set].sort((a, b) => Number(b) - Number(a));
  }, [flights]);

  const filtered = useMemo(() => {
    return flights.filter((flight) => {
      if (yearFilter !== "all") {
        const year = flight.startTime
          ? String(new Date(flight.startTime).getFullYear())
          : "Unknown";
        if (year !== yearFilter) return false;
      }
      if (view === "map" && !flight.location) return false;
      return true;
    });
  }, [flights, yearFilter, view]);

  const grouped = useMemo(() => groupByYear(filtered), [filtered]);
  const filtersActive = yearFilter !== "all";

  function persistView(next?: {
    view?: ViewMode;
    yearFilter?: string;
    map?: FlightsMapCamera | null;
  }) {
    const nextView = next?.view ?? view;
    const nextYear = next?.yearFilter ?? yearFilter;
    const nextMap =
      next?.map === undefined ? mapCameraRef.current : next.map;
    saveFlightsViewState({
      view: nextView,
      yearFilter: nextYear,
      listScrollTop: listScrollRef.current?.scrollTop,
      map: nextMap ?? undefined,
    });
  }

  function rememberOpen() {
    persistView();
  }

  function switchView(next: ViewMode) {
    setView(next);
    persistView({ view: next });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border px-4 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Flights</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {loading
                ? "Loading…"
                : `${filtered.length} session${filtered.length === 1 ? "" : "s"}${
                    filtersActive ? ` of ${flights.length}` : ""
                  } grouped from telemetry`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {filtersActive ? (
              <button
                type="button"
                onClick={() => {
                  setYearFilter("all");
                  persistView({ yearFilter: "all" });
                }}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <X className="size-3" />
                Clear filters
              </button>
            ) : null}
            <div className="flex overflow-hidden rounded-full border border-border text-xs">
              {(
                [
                  ["list", "List", LayoutGrid],
                  ["map", "Map", MapIcon],
                ] as const
              ).map(([mode, label, Icon]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => switchView(mode)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 font-medium transition",
                    view === mode
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {!loading && flights.length > 0 && years.length > 1 ? (
          <FilterRow label="Year">
            <FilterPill
              active={yearFilter === "all"}
              onClick={() => {
                setYearFilter("all");
                persistView({ yearFilter: "all" });
              }}
            >
              All
            </FilterPill>
            {years.map((year) => (
              <FilterPill
                key={year}
                active={yearFilter === year}
                onClick={() => {
                  setYearFilter(year);
                  persistView({ yearFilter: year });
                }}
              >
                {year}
              </FilterPill>
            ))}
          </FilterRow>
        ) : null}
      </div>

      <div
        ref={listScrollRef}
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          view === "list" ? "overflow-auto p-4" : "p-4",
        )}
      >
        {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}

        {loading ? (
          view === "map" ? (
            <div className="min-h-64 flex-1 animate-pulse rounded-xl bg-muted/40" />
          ) : (
            <MediaGridSkeleton
              count={12}
              className="grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4 [&_>div]:aspect-[16/9] [&_>div]:rounded-xl"
            />
          )
        ) : filtered.length === 0 ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <Plane className="size-6 text-muted-foreground/70" />
            <p className="text-sm text-muted-foreground">
              {filtersActive
                ? "No flights match these filters."
                : "No flights yet. Upload videos with SRT sidecars to create flights; geotagged photos nearby are attached automatically."}
            </p>
            {filtersActive ? (
              <button
                type="button"
                onClick={() => {
                  setYearFilter("all");
                  persistView({ yearFilter: "all" });
                }}
                className="text-sm text-primary hover:underline"
              >
                Clear filters
              </button>
            ) : (
              <Link
                href="/upload"
                className="text-sm text-primary hover:underline"
              >
                Go to upload
              </Link>
            )}
          </div>
        ) : view === "map" ? (
          <FlightsMapView
            flights={filtered}
            className="min-h-[28rem] flex-1"
            initialCamera={mapCamera}
            onCameraChange={(camera) => {
              mapCameraRef.current = camera;
              setMapCamera(camera);
            }}
            onOpenFlight={() => rememberOpen()}
          />
        ) : (
          <div className="space-y-7">
            {grouped.map(([year, yearFlights]) => (
              <section key={year}>
                <h2 className="mb-2.5 text-base font-semibold tracking-tight text-primary">
                  {year}
                </h2>
                <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4">
                  {yearFlights.map((flight) => (
                    <Link
                      key={flight.id}
                      href={`/flights/${flight.id}`}
                      onClick={() => rememberOpen()}
                      className="group overflow-hidden rounded-xl border border-border bg-card transition hover:border-primary/40 hover:shadow-sm"
                    >
                      <div className="relative aspect-[16/9] bg-muted">
                        {flight.coverAssetId ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/assets/${flight.coverAssetId}/thumbnail`}
                            alt=""
                            className="size-full object-cover transition duration-300 group-hover:scale-[1.02]"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex size-full items-center justify-center">
                            <Plane className="size-5 text-muted-foreground/50" />
                          </div>
                        )}
                        {flight.location ? (
                          <span className="absolute right-1.5 top-1.5 inline-flex rounded bg-black/50 p-1 text-white">
                            <MapPin className="size-3" />
                          </span>
                        ) : null}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2.5 pb-2 pt-6">
                          <p className="truncate text-xs font-semibold text-white sm:text-sm">
                            {flight.title ?? "Untitled flight"}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-1 px-2.5 py-2">
                        <p className="truncate text-[11px] text-muted-foreground">
                          {formatWhen(flight.startTime)}
                        </p>
                        <div className="flex flex-wrap gap-1 text-[10px]">
                          {flight.droneName ? (
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                              {flight.droneName}
                            </span>
                          ) : null}
                          <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                            {flight.assetCount} clip
                            {flight.assetCount === 1 ? "" : "s"}
                          </span>
                          {flight.totalDistanceMeters != null ? (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                              {(flight.totalDistanceMeters / 1000).toFixed(1)} km
                            </span>
                          ) : null}
                          {formatDuration(flight.totalDurationSeconds) ? (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                              {formatDuration(flight.totalDurationSeconds)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
