"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";

import { TimelineView } from "@/components/timeline/timeline-view";
import { TripMapView } from "@/components/trips/trip-map-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatTripDateRange, tripDayCount } from "@/lib/trips/format";
import type { TripDetailDto } from "@/lib/trips/types";
import { setMediaReturnPath } from "@/lib/navigation/media-return";

export function TripDetailView({ tripId }: { tripId: string }) {
  const [trip, setTrip] = useState<TripDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/trips/${tripId}`);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(
        body?.error ??
          (response.status === 404 ? "Trip not found" : "Failed to load"),
      );
      return;
    }
    const payload = (await response.json()) as { trip: TripDetailDto };
    setTrip(payload.trip);
    setName(payload.trip.name);
    setStartDate(payload.trip.startDate);
    setEndDate(payload.trip.endDate);
    setError(null);
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setMediaReturnPath(`/trips/${tripId}`);
  }, [tripId]);

  async function saveTrip(event: React.FormEvent) {
    event.preventDefault();
    if (!trip) return;
    setBusy(true);
    const response = await fetch(`/api/trips/${tripId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), startDate, endDate }),
    });
    setBusy(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(payload?.error ?? "Failed to save");
      return;
    }
    setEditing(false);
    await load();
  }

  async function deleteTrip() {
    if (!trip) return;
    if (
      !confirm(
        `Delete trip “${trip.name}”? Your media stays in the library.`,
      )
    ) {
      return;
    }
    setBusy(true);
    const response = await fetch(`/api/trips/${tripId}`, { method: "DELETE" });
    setBusy(false);
    if (!response.ok) {
      setError("Failed to delete");
      return;
    }
    window.location.href = "/trips";
  }

  if (error && !trip) {
    return (
      <h1 className="p-8 text-center text-sm text-destructive">{error}</h1>
    );
  }

  if (!trip) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Loading trip…
      </div>
    );
  }

  const days = tripDayCount(trip.startDate, trip.endDate);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="grid shrink-0 gap-4 border-b border-border px-4 py-3 lg:grid-cols-[minmax(0,1fr)_min(44%,26rem)] lg:items-start lg:gap-5 lg:py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start gap-2">
            <Link
              href="/trips"
              aria-label="All trips"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-muted"
            >
              <ArrowLeft className="size-5" />
            </Link>
            <div className="min-w-0 flex-1">
              {editing ? (
                <form
                  onSubmit={(e) => void saveTrip(e)}
                  className="space-y-3"
                >
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={120}
                    required
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      required
                    />
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      min={startDate}
                      required
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={busy}>
                      Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <h1 className="text-xl font-semibold tracking-tight">
                    {trip.name}
                  </h1>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {formatTripDateRange(trip.startDate, trip.endDate)} ·{" "}
                    {days} day{days === 1 ? "" : "s"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    photos {trip.photoCount} · videos {trip.videoCount}
                  </p>
                </>
              )}
            </div>
            {!editing ? (
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="size-4" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void deleteTrip()}
                  disabled={busy}
                >
                  <Trash2 className="size-4" />
                  Delete
                </Button>
              </div>
            ) : null}
          </div>
          {error ? (
            <p className="mt-2 text-sm text-destructive">{error}</p>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card lg:row-span-1">
          {trip.locatedCount > 0 ? (
            <TripMapView
              tripId={tripId}
              className="h-[min(42vh,360px)] min-h-[220px] rounded-none border-0 bg-muted lg:h-[min(48vh,400px)]"
            />
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No geotagged media in this date range.
            </p>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <TimelineView tripId={tripId} variant="embedded" />
      </div>
    </div>
  );
}