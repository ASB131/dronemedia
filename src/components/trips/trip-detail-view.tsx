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
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Link
          href="/trips"
          className="inline-flex size-9 items-center justify-center rounded-full hover:bg-muted"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              onSubmit={(e) => void saveTrip(e)}
              className="space-y-2"
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
              <h1 className="truncate text-xl font-semibold tracking-tight">
                {trip.name}
              </h1>
              <p className="text-xs text-muted-foreground">
                {formatTripDateRange(trip.startDate, trip.endDate)} · {days}{" "}
                day{days === 1 ? "" : "s"} · photos {trip.photoCount} · videos{" "}
                {trip.videoCount}
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
        {error ? (
          <p className="w-full text-sm text-destructive">{error}</p>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <section className="flex min-h-[42vh] min-w-0 flex-col overflow-hidden border-b border-border lg:min-h-0 lg:border-b-0 lg:border-r">
          <TimelineView tripId={tripId} variant="embedded" />
        </section>

        <section className="relative flex min-h-[36vh] flex-col bg-muted/30 lg:min-h-0">
          {trip.locatedCount > 0 ? (
            <TripMapView
              tripId={tripId}
              className="absolute inset-0 min-h-full rounded-none border-0"
            />
          ) : (
            <div className="flex h-full min-h-48 items-center justify-center px-4 text-center text-sm text-muted-foreground">
              No geotagged media in this date range.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}