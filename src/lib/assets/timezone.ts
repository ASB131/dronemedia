import { find as findTimezones } from "geo-tz";

/** Resolve IANA timezone from WGS84 coordinates. */
export function timezoneFromGps(lat: number, lng: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  try {
    const zones = findTimezones(lat, lng);
    return zones[0] ?? null;
  } catch {
    return null;
  }
}

export function parseLocationWkt(
  wkt: string | null | undefined,
): { lat: number; lng: number } | null {
  if (!wkt) return null;
  const match = /POINT\(([-0-9.]+)\s+([-0-9.]+)\)/i.exec(wkt);
  if (!match) return null;
  const lng = Number(match[1]);
  const lat = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}
