"use client";

import { useEffect, useState } from "react";

import { FlightPathPreview } from "@/components/assets/flight-path-preview";
import type { LineStringGeoJson } from "@/lib/assets/telemetry";
import { cn } from "@/lib/utils";

type PreviewPayload = {
  location: { lat: number; lng: number } | null;
  flightPath: LineStringGeoJson | null;
};

/**
 * Compact map shown while hovering a timeline tile / day.
 * Fetches path lazily; pins use inline location when provided.
 */
export function TimelineHoverMiniMap({
  assetId,
  location,
  hasFlightPath,
  className,
}: {
  assetId: string | null;
  location?: { lat: number; lng: number } | null;
  hasFlightPath?: boolean;
  className?: string;
}) {
  const [path, setPath] = useState<LineStringGeoJson | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!assetId || !hasFlightPath) {
      setPath(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch(`/api/assets/${assetId}/telemetry`);
        if (!response.ok) return;
        const payload = (await response.json()) as PreviewPayload & {
          flightPath: LineStringGeoJson | null;
        };
        if (!cancelled) setPath(payload.flightPath);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId, hasFlightPath]);

  if (!assetId && !location) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border border-border bg-muted/30 text-xs text-muted-foreground",
          className,
        )}
      >
        Hover a geotagged shot
      </div>
    );
  }

  const hasMap = Boolean(path?.coordinates.length) || Boolean(location);
  if (!hasMap && !loading) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border border-border bg-muted/30 text-xs text-muted-foreground",
          className,
        )}
      >
        No map for this item
      </div>
    );
  }

  return (
    <FlightPathPreview
      flightPath={path}
      currentPosition={location ?? null}
      markerKind="photo"
      className={cn("overflow-hidden rounded-xl", className)}
    />
  );
}
