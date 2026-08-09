"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Plane, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FlightSummaryDto } from "@/lib/flights/queries";
import { distanceMeters } from "@/lib/map/colocated-layout";
import { cn } from "@/lib/utils";

const SUGGEST_TIME_MS = 90 * 60 * 1000;
const SUGGEST_DISTANCE_M = 5_000;

type RankedFlight = FlightSummaryDto & {
  distanceMeters: number | null;
  timeDeltaMs: number | null;
  suggested: boolean;
  reason: string | null;
};

function formatWhen(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDistance(meters: number | null) {
  if (meters == null) return null;
  if (meters < 1000) return `${Math.round(meters)} m away`;
  return `${(meters / 1000).toFixed(1)} km away`;
}

function formatTimeDelta(ms: number | null) {
  if (ms == null) return null;
  const mins = Math.round(Math.abs(ms) / 60_000);
  if (mins < 60) return `${mins} min apart`;
  const hours = Math.round(mins / 60);
  return `${hours} h apart`;
}

function windowDeltaMs(
  aStart: number | null,
  aEnd: number | null,
  bStart: number | null,
  bEnd: number | null,
) {
  if (aStart == null || bStart == null) return null;
  const aLo = aStart;
  const aHi = aEnd ?? aStart;
  const bLo = bStart;
  const bHi = bEnd ?? bStart;
  if (aHi < bLo) return bLo - aHi;
  if (bHi < aLo) return aLo - bHi;
  return 0;
}

function rankFlights(params: {
  flights: FlightSummaryDto[];
  startTime: string | null;
  endTime: string | null;
  location: { lat: number; lng: number } | null;
}): RankedFlight[] {
  const startMs = params.startTime
    ? new Date(params.startTime).getTime()
    : null;
  const endMs = params.endTime ? new Date(params.endTime).getTime() : startMs;

  return params.flights
    .map((flight) => {
      const otherStart = flight.startTime
        ? new Date(flight.startTime).getTime()
        : null;
      const otherEnd = flight.endTime
        ? new Date(flight.endTime).getTime()
        : otherStart;
      const timeDeltaMs = windowDeltaMs(startMs, endMs, otherStart, otherEnd);

      const dist =
        params.location && flight.location
          ? distanceMeters(params.location, flight.location)
          : null;

      const nearTime =
        timeDeltaMs != null && Math.abs(timeDeltaMs) <= SUGGEST_TIME_MS;
      const nearPlace = dist != null && dist <= SUGGEST_DISTANCE_M;
      const suggested = nearTime || nearPlace;

      const reasons: string[] = [];
      if (nearPlace && dist != null) {
        reasons.push(formatDistance(dist) ?? "Nearby");
      }
      if (nearTime && timeDeltaMs != null) {
        reasons.push(
          timeDeltaMs === 0
            ? "Overlapping time"
            : (formatTimeDelta(timeDeltaMs) ?? "Nearby time"),
        );
      }

      return {
        ...flight,
        distanceMeters: dist,
        timeDeltaMs,
        suggested,
        reason: reasons.length > 0 ? reasons.join(" · ") : null,
      };
    })
    .sort((a, b) => {
      if (a.suggested !== b.suggested) return a.suggested ? -1 : 1;
      const aTime =
        a.timeDeltaMs == null
          ? Number.POSITIVE_INFINITY
          : Math.abs(a.timeDeltaMs);
      const bTime =
        b.timeDeltaMs == null
          ? Number.POSITIVE_INFINITY
          : Math.abs(b.timeDeltaMs);
      if (aTime !== bTime) return aTime - bTime;
      const aDist = a.distanceMeters ?? Number.POSITIVE_INFINITY;
      const bDist = b.distanceMeters ?? Number.POSITIVE_INFINITY;
      return aDist - bDist;
    });
}

export function CombineFlightsModal({
  open,
  onClose,
  flights,
  startTime,
  endTime,
  location,
  saving,
  onCombine,
}: {
  open: boolean;
  onClose: () => void;
  flights: FlightSummaryDto[];
  startTime: string | null;
  endTime: string | null;
  location: { lat: number; lng: number } | null;
  saving: boolean;
  onCombine: (sourceFlightId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [confirmFlight, setConfirmFlight] = useState<RankedFlight | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setConfirmFlight(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (confirmFlight) setConfirmFlight(null);
        else onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, confirmFlight]);

  const ranked = useMemo(
    () =>
      rankFlights({
        flights,
        startTime,
        endTime,
        location,
      }),
    [flights, startTime, endTime, location],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ranked;
    return ranked.filter((flight) => {
      const hay = [
        flight.title,
        flight.droneName,
        flight.startTime ? formatWhen(flight.startTime) : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [ranked, query]);

  const suggestions = filtered.filter((f) => f.suggested);
  const others = filtered.filter((f) => !f.suggested);

  if (!open || !mounted) return null;

  function renderRow(flight: RankedFlight) {
    return (
      <button
        key={flight.id}
        type="button"
        disabled={saving}
        onClick={() => setConfirmFlight(flight)}
        className={cn(
          "flex w-full items-stretch gap-3 rounded-xl border border-border bg-background px-3 py-2.5 text-left transition hover:border-primary/40 hover:bg-muted/40",
          saving && "opacity-60",
        )}
      >
        <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
          {flight.coverAssetId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/assets/${flight.coverAssetId}/thumbnail`}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <Plane className="size-5 text-muted-foreground/60" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {flight.title ?? "Untitled flight"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatWhen(flight.startTime)}
            {" · "}
            {flight.assetCount} asset{flight.assetCount === 1 ? "" : "s"}
            {flight.droneName ? ` · ${flight.droneName}` : ""}
          </p>
          {flight.reason ? (
            <p className="mt-1 text-[11px] text-primary">{flight.reason}</p>
          ) : null}
        </div>
      </button>
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/60 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Combine flights"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(88vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">
              {confirmFlight ? "Confirm combine" : "Combine flights"}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {confirmFlight
                ? "This cannot be undone"
                : "Merge another flight into this one"}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>

        {confirmFlight ? (
          <>
            <div className="space-y-3 px-4 py-4">
              <p className="text-sm text-foreground">
                Merge{" "}
                <span className="font-medium">
                  {confirmFlight.title ?? "Untitled flight"}
                </span>{" "}
                ({confirmFlight.assetCount} asset
                {confirmFlight.assetCount === 1 ? "" : "s"}) into this flight?
              </p>
              <p className="text-xs text-muted-foreground">
                All media from that flight will move here and the other flight
                will be removed. This step can&apos;t be undone.
              </p>
              {confirmFlight.reason ? (
                <p className="text-[11px] text-primary">{confirmFlight.reason}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => setConfirmFlight(null)}
              >
                Back
              </Button>
              <Button
                size="sm"
                disabled={saving}
                onClick={() => onCombine(confirmFlight.id)}
              >
                {saving ? "Combining…" : "Combine flights"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="border-b border-border px-4 py-3">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search flights…"
                autoFocus
              />
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
              {suggestions.length > 0 ? (
                <section className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Suggested
                  </p>
                  <div className="space-y-2">{suggestions.map(renderRow)}</div>
                </section>
              ) : null}

              <section className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {suggestions.length > 0 ? "All flights" : "Flights"}
                </p>
                {others.length > 0 ? (
                  <div className="space-y-2">{others.map(renderRow)}</div>
                ) : filtered.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                    No other flights to combine
                  </p>
                ) : suggestions.length > 0 && others.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No other flights
                  </p>
                ) : null}
              </section>
            </div>

            <div className="flex justify-end border-t border-border px-4 py-3">
              <Button
                size="sm"
                variant="outline"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
