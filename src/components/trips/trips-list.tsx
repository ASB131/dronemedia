"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Luggage, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MediaGridSkeleton } from "@/components/ui/skeletons";
import { formatTripDateRange, tripDayCount } from "@/lib/trips/format";
import type { TripSummaryDto } from "@/lib/trips/types";

function groupByYear(trips: TripSummaryDto[]) {
  const groups = new Map<string, TripSummaryDto[]>();
  for (const trip of trips) {
    const year = trip.startDate.slice(0, 4);
    const list = groups.get(year) ?? [];
    list.push(trip);
    groups.set(year, list);
  }
  return [...groups.entries()].sort((a, b) => Number(b[0]) - Number(a[0]));
}

export function TripsList() {
  const [trips, setTrips] = useState<TripSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function reload() {
    const response = await fetch("/api/trips");
    if (!response.ok) {
      setError("Failed to load trips");
      return;
    }
    const payload = (await response.json()) as { trips: TripSummaryDto[] };
    setTrips(payload.trips);
    setError(null);
  }

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      await reload();
      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const byYear = useMemo(() => groupByYear(trips), [trips]);

  async function createTrip(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !startDate || !endDate) return;
    setBusy(true);
    setError(null);
    const response = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        startDate,
        endDate,
      }),
    });
    setBusy(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(payload?.error ?? "Failed to create trip");
      return;
    }
    const payload = (await response.json()) as { id: string };
    setName("");
    setStartDate("");
    setEndDate("");
    setCreating(false);
    await reload();
    window.location.href = `/trips/${payload.id}`;
  }

  async function deleteTrip(trip: TripSummaryDto) {
    if (
      !confirm(
        `Delete trip “${trip.name}”? Your media stays in the library — only this grouping is removed.`,
      )
    ) {
      return;
    }
    setDeletingId(trip.id);
    const response = await fetch(`/api/trips/${trip.id}`, {
      method: "DELETE",
    });
    setDeletingId(null);
    if (!response.ok) {
      setError("Failed to delete trip");
      return;
    }
    await reload();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trips</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : `${trips.length} trip${trips.length === 1 ? "" : "s"} — group media by travel dates`}
          </p>
        </div>
        <Button
          size="sm"
          variant={creating ? "outline" : "default"}
          onClick={() => setCreating((v) => !v)}
        >
          <Luggage className="size-4" />
          {creating ? "Cancel" : "New trip"}
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {creating ? (
          <form
            onSubmit={(e) => void createTrip(e)}
            className="mb-6 max-w-lg space-y-3 rounded-xl border border-border bg-card p-4"
          >
            <h2 className="text-sm font-medium">Create trip</h2>
            <Input
              placeholder="Trip name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                Start date
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                End date
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate || undefined}
                  required
                />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Media is included when its capture date falls within this range
              (inclusive).
            </p>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Creating…" : "Create trip"}
            </Button>
          </form>
        ) : null}

        {error ? (
          <p className="mb-4 text-sm text-destructive">{error}</p>
        ) : null}

        {loading ? (
          <MediaGridSkeleton count={6} />
        ) : trips.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
            No trips yet. Create one to gather photos and videos from a date
            range.
          </div>
        ) : (
          <div className="space-y-8">
            {byYear.map(([year, items]) => (
              <section key={year}>
                <h2 className="mb-3 text-lg font-semibold">{year}</h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((trip) => (
                    <article
                      key={trip.id}
                      className="group relative overflow-hidden rounded-xl border border-border bg-card"
                    >
                      <Link
                        href={`/trips/${trip.id}`}
                        className="block"
                      >
                        <div className="aspect-[16/10] bg-muted">
                          {trip.coverAssetId ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`/api/assets/${trip.coverAssetId}/thumbnail`}
                              alt=""
                              className="size-full object-cover"
                            />
                          ) : (
                            <div className="flex size-full items-center justify-center text-muted-foreground">
                              <CalendarRange className="size-10 opacity-40" />
                            </div>
                          )}
                        </div>
                        <div className="p-3">
                          <p className="font-medium leading-snug">{trip.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatTripDateRange(
                              trip.startDate,
                              trip.endDate,
                            )}
                            {" · "}
                            {tripDayCount(trip.startDate, trip.endDate)} day
                            {tripDayCount(trip.startDate, trip.endDate) === 1
                              ? ""
                              : "s"}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {trip.assetCount} item
                            {trip.assetCount === 1 ? "" : "s"}
                          </p>
                        </div>
                      </Link>
                      <button
                        type="button"
                        aria-label="Delete trip"
                        className="absolute right-2 top-2 rounded-lg bg-background/80 p-1.5 opacity-0 shadow-sm transition group-hover:opacity-100"
                        disabled={deletingId === trip.id}
                        onClick={() => void deleteTrip(trip)}
                      >
                        <Trash2 className="size-4 text-muted-foreground" />
                      </button>
                    </article>
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