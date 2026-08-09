/** Forward geocode via OpenStreetMap Nominatim (no API key). */

export type ForwardGeocodeResult = {
  label: string | null;
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
};

export async function forwardGeocode(
  query: string,
): Promise<ForwardGeocodeResult | null> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return null;

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("q", trimmed);
    url.searchParams.set("limit", "1");
    const response = await fetch(url, {
      headers: {
        "User-Agent": "DroneMedia/0.1 (self-hosted; contact=local)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as Array<{
      display_name?: string;
      boundingbox?: [string, string, string, string];
      lat?: string;
      lon?: string;
    }>;
    const hit = payload[0];
    if (!hit) return null;

    if (hit.boundingbox?.length === 4) {
      const south = Number(hit.boundingbox[0]);
      const north = Number(hit.boundingbox[1]);
      const west = Number(hit.boundingbox[2]);
      const east = Number(hit.boundingbox[3]);
      if (
        [south, north, west, east].every((value) => Number.isFinite(value))
      ) {
        return {
          label: hit.display_name ?? trimmed,
          minLat: Math.min(south, north),
          maxLat: Math.max(south, north),
          minLng: Math.min(west, east),
          maxLng: Math.max(west, east),
        };
      }
    }

    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    // ~25km box around a point result
    const delta = 0.22;
    return {
      label: hit.display_name ?? trimmed,
      minLat: lat - delta,
      maxLat: lat + delta,
      minLng: lng - delta,
      maxLng: lng + delta,
    };
  } catch {
    return null;
  }
}
