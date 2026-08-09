/** Approximate meters → degrees at mid latitudes (privacy fuzzing). */
const METERS_PER_DEG_LAT = 111_320;

function offsetPoint(
  lng: number,
  lat: number,
  bearingDeg: number,
  distanceMeters: number,
): [number, number] {
  const latRad = (lat * Math.PI) / 180;
  const dLat = (distanceMeters * Math.cos((bearingDeg * Math.PI) / 180)) /
    METERS_PER_DEG_LAT;
  const dLng =
    (distanceMeters * Math.sin((bearingDeg * Math.PI) / 180)) /
    (METERS_PER_DEG_LAT * Math.max(0.2, Math.cos(latRad)));
  return [lng + dLng, lat + dLat];
}

/**
 * Redact launch privacy for public shares / community map.
 * Drops / offsets the first and last segments of a path (~150–250m).
 */
export function fuzzFlightPath(
  coordinates: Array<[number, number]>,
  radiusMeters = 200,
): Array<[number, number]> {
  if (coordinates.length < 4) return [];
  const drop = Math.min(
    Math.max(2, Math.floor(coordinates.length * 0.08)),
    Math.floor(coordinates.length / 3),
  );
  const trimmed = coordinates.slice(drop, coordinates.length - drop);
  if (trimmed.length < 2) return [];

  const first = trimmed[0]!;
  const last = trimmed[trimmed.length - 1]!;
  const fuzzed = [...trimmed];
  fuzzed[0] = offsetPoint(first[0], first[1], 45, radiusMeters);
  fuzzed[fuzzed.length - 1] = offsetPoint(last[0], last[1], 225, radiusMeters);
  return fuzzed;
}

/** Deterministic offset for a single public media GPS point. */
export function fuzzMediaPoint(
  coordinates: [number, number],
  radiusMeters = 250,
): [number, number] {
  const seed = Math.abs(coordinates[0] * 1000 + coordinates[1] * 100) % 360;
  return offsetPoint(coordinates[0], coordinates[1], seed, radiusMeters);
}
