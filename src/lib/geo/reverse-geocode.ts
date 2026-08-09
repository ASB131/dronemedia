/** Reverse geocode via OpenStreetMap Nominatim (no API key). */

export type ReverseGeocodeResult = {
  label: string | null;
  place: string | null;
  country: string | null;
};

export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<ReverseGeocodeResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { label: null, place: null, country: null };
  }
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("zoom", "14");
    const response = await fetch(url, {
      headers: {
        "User-Agent": "DroneMedia/0.1 (self-hosted; contact=local)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) {
      return { label: null, place: null, country: null };
    }
    const payload = (await response.json()) as {
      display_name?: string;
      name?: string;
      address?: Record<string, string>;
    };
    const address = payload.address ?? {};
    const country = address.country ?? null;
    const place =
      payload.name ??
      address.village ??
      address.town ??
      address.city ??
      address.hamlet ??
      address.suburb ??
      address.county ??
      null;

    const parts = [
      place,
      address.county && address.county !== place ? address.county : null,
      address.state,
      country,
    ].filter(Boolean);

    return {
      label: parts.length
        ? parts.join(", ")
        : (payload.display_name ?? null),
      place,
      country,
    };
  } catch {
    return { label: null, place: null, country: null };
  }
}
