"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Luggage, Settings2, Trash2 } from "lucide-react";

import { TripSettingsDialog } from "@/components/trips/trip-settings-dialog";
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
  const [settingsTrip, setSettingsTrip] = useState<TripSummaryDto | null>(null);

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

  async function deleteTrip(trip: TripSummaryDto, event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
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

  function openSettings(trip: TripSummaryDto, event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setSettingsTrip(trip);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trips</h1>
          {loading ? (
            <p className="mt-0.5 text-sm text-muted-foreground">Loading…</p>
          ) : null}
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
          <MediaGridSkeleton count={8} />
        ) : trips.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
            No trips yet. Create one to gather photos and videos from a date
            range.
          </div>
        ) : (
          <div className="space-y-6">
            {byYear.map(([year, items]) => (
              <section key={year}>
                <h2 className="mb-2 text-base font-semibold">{year}</h2>
                <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {items.map((trip) => (
                    <article
                      key={trip.id}
                      className="group relative overflow-hidden rounded-lg border border-border bg-card"
                    >
                      <Link href={`/trips/${trip.id}`} className="block">
                        <div className="aspect-[4/3] bg-muted">
                          {trip.coverThumbnailUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={trip.coverThumbnailUrl}
                              alt=""
                              className="size-full object-cover"
                            />
                          ) : (
                            <div className="flex size-full items-center justify-center text-muted-foreground">
                              <CalendarRange className="size-6 opacity-40" />
                            </div>
                          )}
                        </div>
                        <div className="px-2 py-1.5">
                          <p className="truncate text-sm font-medium leading-snug">
                            {trip.name}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {formatTripDateRange(
                              trip.startDate,
                              trip.endDate,
                            )}
                            {" · "}
                            {trip.assetCount} item
                            {trip.assetCount === 1 ? "" : "s"}
                          </p>
                        </div>
                      </Link>
                      <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition group-hover:opacity-100">
                        <button
                          type="button"
                          aria-label="Trip settings"
                          className="cursor-pointer rounded-md bg-background/90 p-1 shadow-sm"
                          onClick={(e) => openSettings(trip, e)}
                        >
                          <Settings2 className="size-3.5 text-muted-foreground" />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete trip"
                          className="cursor-pointer rounded-md bg-background/90 p-1 shadow-sm"
                          disabled={deletingId === trip.id}
                          onClick={(e) => void deleteTrip(trip, e)}
                        >
                          <Trash2 className="size-3.5 text-muted-foreground" />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <TripSettingsDialog
        trip={settingsTrip}
        open={settingsTrip != null}
        onClose={() => setSettingsTrip(null)}
        onSaved={reload}
      />
    </div>
  );
}