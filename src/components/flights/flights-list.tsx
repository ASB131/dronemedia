"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Plane } from "lucide-react";

import { MediaGridSkeleton } from "@/components/ui/skeletons";
import type { FlightSummaryDto } from "@/lib/flights/queries";

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

export function FlightsList() {
  const [flights, setFlights] = useState<FlightSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [droneFilter, setDroneFilter] = useState("all");

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

  const drones = useMemo(() => {
    const map = new Map<string, string>();
    for (const flight of flights) {
      if (flight.droneId && flight.droneName) {
        map.set(flight.droneId, flight.droneName);
      }
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [flights]);

  const filtered = useMemo(() => {
    if (droneFilter === "all") return flights;
    if (droneFilter === "none") {
      return flights.filter((flight) => !flight.droneId);
    }
    return flights.filter((flight) => flight.droneId === droneFilter);
  }, [flights, droneFilter]);

  const grouped = useMemo(() => groupByYear(filtered), [filtered]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Flights</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : `${filtered.length} session${filtered.length === 1 ? "" : "s"} grouped from telemetry`}
          </p>
        </div>
        {drones.length > 0 || flights.some((f) => !f.droneId) ? (
          <label className="text-xs text-muted-foreground">
            Drone
            <select
              className="ml-2 h-9 rounded-lg border border-border bg-background px-2.5 text-sm text-foreground"
              value={droneFilter}
              onChange={(event) => setDroneFilter(event.target.value)}
            >
              <option value="all">All drones</option>
              <option value="none">Unassigned</option>
              {drones.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {loading ? (
          <MediaGridSkeleton
            count={12}
            className="grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 [&_>div]:aspect-[16/9] [&_>div]:rounded-2xl"
          />
        ) : filtered.length === 0 ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <Plane className="size-8 text-muted-foreground/70" />
            <p className="text-sm text-muted-foreground">
              No flights yet. Upload videos with SRT sidecars to create flights;
              geotagged photos nearby are attached automatically.
            </p>
            <Link href="/upload" className="text-sm text-primary hover:underline">
              Go to upload
            </Link>
          </div>
        ) : (
          <div className="space-y-8">
            {grouped.map(([year, yearFlights]) => (
              <section key={year}>
                <h2 className="mb-3 text-lg font-semibold tracking-tight text-primary">
                  {year}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {yearFlights.map((flight) => (
                    <Link
                      key={flight.id}
                      href={`/flights/${flight.id}`}
                      className="group overflow-hidden rounded-2xl border border-border bg-card transition hover:border-primary/40 hover:shadow-sm"
                    >
                      <div className="relative aspect-[16/9] bg-muted">
                        {flight.coverAssetId ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/assets/${flight.coverAssetId}/thumbnail`}
                            alt=""
                            className="size-full object-cover transition duration-300 group-hover:scale-[1.02]"
                          />
                        ) : (
                          <div className="flex size-full items-center justify-center">
                            <Plane className="size-8 text-muted-foreground/50" />
                          </div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2.5 pt-8">
                          <p className="truncate text-sm font-semibold text-white">
                            {flight.title ?? "Untitled flight"}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-1.5 px-3.5 py-3">
                        <p className="text-xs text-muted-foreground">
                          {formatWhen(flight.startTime)}
                        </p>
                        <div className="flex flex-wrap gap-1.5 text-[11px]">
                          <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
                            {flight.assetCount} clip
                            {flight.assetCount === 1 ? "" : "s"}
                          </span>
                          {flight.droneName ? (
                            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-primary">
                              {flight.droneName}
                            </span>
                          ) : null}
                          {flight.totalDistanceMeters != null ? (
                            <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
                              {(flight.totalDistanceMeters / 1000).toFixed(2)} km
                            </span>
                          ) : null}
                          {formatDuration(flight.totalDurationSeconds) ? (
                            <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
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
