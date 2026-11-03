import type { TelemetrySeriesPoint } from "@/lib/assets/telemetry";

export type LatLngAlt = {
  lat: number;
  lng: number;
  altMeters: number;
};

/** Bearing degrees (0 = north) from a to b. */
export function bearingDegrees(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const φ1 = (from.lat * Math.PI) / 180;
  const φ2 = (to.lat * Math.PI) / 180;
  const Δλ = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function interpolateSeriesAtOffsetMs(
  series: TelemetrySeriesPoint[],
  offsetMs: number,
): LatLngAlt | null {
  if (series.length === 0) return null;
  if (series.length === 1) {
    const p = series[0]!;
    return {
      lat: p.lat,
      lng: p.lng,
      altMeters: p.altitudeMeters,
    };
  }

  const t = Math.max(0, offsetMs);
  if (t <= series[0]!.offsetMs) {
    const p = series[0]!;
    return { lat: p.lat, lng: p.lng, altMeters: p.altitudeMeters };
  }
  const last = series[series.length - 1]!;
  if (t >= last.offsetMs) {
    return { lat: last.lat, lng: last.lng, altMeters: last.altitudeMeters };
  }

  for (let i = 0; i < series.length - 1; i++) {
    const a = series[i]!;
    const b = series[i + 1]!;
    if (t >= a.offsetMs && t <= b.offsetMs) {
      const span = b.offsetMs - a.offsetMs;
      const u = span > 0 ? (t - a.offsetMs) / span : 0;
      return {
        lat: a.lat + (b.lat - a.lat) * u,
        lng: a.lng + (b.lng - a.lng) * u,
        altMeters: a.altitudeMeters + (b.altitudeMeters - a.altitudeMeters) * u,
      };
    }
  }

  return {
    lat: last.lat,
    lng: last.lng,
    altMeters: last.altitudeMeters,
  };
}

export function seriesToDegreesHeights(
  series: TelemetrySeriesPoint[],
): number[] {
  const out: number[] = [];
  for (const point of series) {
    out.push(point.lng, point.lat, point.altitudeMeters);
  }
  return out;
}

/** Insert points between samples so 3D paths look smooth. */
export function densifySeries(
  series: TelemetrySeriesPoint[],
  stepMs = 120,
): TelemetrySeriesPoint[] {
  if (series.length < 2) return series;
  const out: TelemetrySeriesPoint[] = [];
  for (let i = 0; i < series.length - 1; i++) {
    const a = series[i]!;
    const b = series[i + 1]!;
    out.push(a);
    const span = b.offsetMs - a.offsetMs;
    if (span <= stepMs) continue;
    const steps = Math.min(Math.floor(span / stepMs), 48);
    for (let s = 1; s < steps; s++) {
      const u = s / steps;
      out.push({
        lat: a.lat + (b.lat - a.lat) * u,
        lng: a.lng + (b.lng - a.lng) * u,
        altitudeMeters:
          a.altitudeMeters + (b.altitudeMeters - a.altitudeMeters) * u,
        offsetMs: a.offsetMs + span * u,
        srtTimeMs: a.srtTimeMs + (b.srtTimeMs - a.srtTimeMs) * u,
        speedMps:
          a.speedMps != null && b.speedMps != null
            ? a.speedMps + (b.speedMps - a.speedMps) * u
            : a.speedMps ?? b.speedMps,
      });
    }
  }
  out.push(series[series.length - 1]!);
  return out;
}

export function headingFromSeries(
  series: TelemetrySeriesPoint[],
  offsetMs: number,
): number | null {
  if (series.length < 2) return null;
  const current = interpolateSeriesAtOffsetMs(series, offsetMs);
  if (!current) return null;

  for (let i = 0; i < series.length - 1; i++) {
    const a = series[i]!;
    const b = series[i + 1]!;
    if (offsetMs >= a.offsetMs && offsetMs <= b.offsetMs) {
      return bearingDegrees(a, b);
    }
  }

  const a = series[series.length - 2]!;
  const b = series[series.length - 1]!;
  return bearingDegrees(a, b);
}
