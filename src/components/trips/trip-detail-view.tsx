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
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-border px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href="/trips"
              className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              All trips
            </Link>
            {editing ? (
              <form
                onSubmit={(e) => void saveTrip(e)}
                className="mt-1 max-w-xl space-y-3"
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
                <h1 className="text-2xl font-semibold tracking-tight">
                  {trip.name}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatTripDateRange(trip.startDate, trip.endDate)} · {days}{" "}
                  day{days === 1 ? "" : "s"}
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

        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div>
            <dt className="text-muted-foreground">Media</dt>
            <dd className="font-medium">{trip.assetCount}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Photos</dt>
            <dd className="font-medium">{trip.photoCount}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Videos</dt>
            <dd className="font-medium">{trip.videoCount}</dd>
          </div>
          {trip.panoramaCount > 0 ? (
            <div>
              <dt className="text-muted-foreground">Panoramas</dt>
              <dd className="font-medium">{trip.panoramaCount}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-muted-foreground">With GPS</dt>
            <dd className="font-medium">{trip.locatedCount}</dd>
          </div>
        </dl>

        {error ? (
          <p className="mt-2 text-sm text-destructive">{error}</p>
        ) : null}
      </header>

      <div className="shrink-0 border-b border-border px-4 py-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Map
        </p>
        {trip.locatedCount > 0 ? (
          <TripMapView tripId={tripId} className="h-[min(40vh,320px)]" />
        ) : (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No geotagged media in this date range.
          </p>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <TimelineView tripId={tripId} />
      </div>
    </div>
  );
}