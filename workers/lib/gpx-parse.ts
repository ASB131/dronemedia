export type ParsedGpxPoint = {
  lat: number;
  lng: number;
  alt: number;
  /** Ms offset from first track point (video sync v1: track start = t0). */
  startMs: number;
  wallClock: Date | null;
};

function parseIsoTime(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Minimal GPX 1.1 track parser (trkpt lat/lon, optional ele and time).
 */
export function parseGpx(xml: string): ParsedGpxPoint[] {
  const points: ParsedGpxPoint[] = [];
  const segmentRegex =
    /<trkseg[\s\S]*?<\/trkseg>/gi;
  const trkptRegex =
    /<trkpt\s+lat="(-?\d+(?:\.\d+)?)"\s+lon="(-?\d+(?:\.\d+)?)"[^>]*>([\s\S]*?)<\/trkpt>/gi;

  const segments = xml.match(segmentRegex) ?? [xml];
  let firstWall: number | null = null;

  for (const segment of segments) {
    let match: RegExpExecArray | null;
    trkptRegex.lastIndex = 0;
    while ((match = trkptRegex.exec(segment)) !== null) {
      const lat = Number(match[1]);
      const lng = Number(match[2]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const inner = match[3] ?? "";
      const eleMatch = /<ele>\s*(-?\d+(?:\.\d+)?)\s*<\/ele>/i.exec(inner);
      const timeMatch = /<time>\s*([^<]+)\s*<\/time>/i.exec(inner);
      const wallClock = parseIsoTime(timeMatch?.[1]?.trim() ?? null);
      const wallMs = wallClock?.getTime() ?? null;
      if (wallMs != null && firstWall == null) firstWall = wallMs;
      const startMs =
        wallMs != null && firstWall != null
          ? Math.max(0, wallMs - firstWall)
          : points.length * 1000;

      points.push({
        lat,
        lng,
        alt: Number(eleMatch?.[1] ?? 0),
        startMs,
        wallClock,
      });
    }
  }

  return points;
}
