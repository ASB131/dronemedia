"use client";

import { cn } from "@/lib/utils";

export type PlaybackHudValues = {
  altitudeMeters: number | null;
  speedMps: number | null;
  homeDistanceMeters: number | null;
  /** Satellite count when known; omitted/null shows as em dash. */
  satellites: number | null;
};

function formatSpeed(mps: number | null) {
  if (mps == null || !Number.isFinite(mps)) return "—";
  return `${(mps * 3.6).toFixed(0)} km/h`;
}

function formatAlt(meters: number | null) {
  if (meters == null || !Number.isFinite(meters)) return "—";
  return `${Math.round(meters)} m`;
}

function formatDistance(meters: number | null) {
  if (meters == null || !Number.isFinite(meters)) return "—";
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

export function PlaybackHud({
  values,
  className,
}: {
  values: PlaybackHudValues;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute left-3 top-3 z-10 rounded-lg border border-white/15 bg-black/55 px-2.5 py-2 text-[11px] text-white shadow-lg backdrop-blur-sm tabular-nums",
        className,
      )}
      aria-live="polite"
    >
      <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1">
        <dt className="text-white/55">Alt</dt>
        <dd className="text-right font-medium">{formatAlt(values.altitudeMeters)}</dd>
        <dt className="text-white/55">Speed</dt>
        <dd className="text-right font-medium">{formatSpeed(values.speedMps)}</dd>
        <dt className="text-white/55">Home</dt>
        <dd className="text-right font-medium">
          {formatDistance(values.homeDistanceMeters)}
        </dd>
        <dt className="text-white/55">Sats</dt>
        <dd className="text-right font-medium">
          {values.satellites != null && Number.isFinite(values.satellites)
            ? Math.round(values.satellites)
            : "—"}
        </dd>
      </dl>
    </div>
  );
}
