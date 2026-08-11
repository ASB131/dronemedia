/**
 * Geographic look-heading for equirect panoramas.
 * Only derived from real EXIF/XMP/DJI tags — never invent a default.
 */

export function normalizeHeadingDegrees(value: unknown): number | null {
  let n: number | null = null;
  if (typeof value === "number" && Number.isFinite(value)) {
    n = value;
  } else if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) n = parsed;
  }
  if (n == null) return null;
  // Keep modest precision; avoid float noise from EXIF numerics.
  const wrapped = ((n % 360) + 360) % 360;
  return Math.round(wrapped * 100) / 100;
}

/**
 * Source priority (first finite wins):
 * 1. GPano PoseHeadingDegrees (heading of equirect center)
 * 2. FlightYawDegree
 * 3. GimbalYawDegree
 * 4. GPSImgDirection (EXIF camera direction when present)
 */
export function poseHeadingDegreesFromTags(
  tags: Record<string, unknown> | null | undefined,
): number | null {
  if (!tags) return null;
  return (
    normalizeHeadingDegrees(tags.PoseHeadingDegrees) ??
    normalizeHeadingDegrees(tags.FlightYawDegree) ??
    normalizeHeadingDegrees(tags.GimbalYawDegree) ??
    normalizeHeadingDegrees(tags.GPSImgDirection)
  );
}

/**
 * Look bearing from equirect center pose + PSV camera yaw.
 * Texture center (yaw 0) faces `poseHeadingDegrees`.
 * Use yaw − pose so panning toward east increases the compass reading
 * while keeping north at the same view as pose − yaw (0 when yaw = pose).
 * Map cones use this same value so they stay aligned with the heading tape.
 */
export function lookHeadingDegrees(
  poseHeadingDegrees: number,
  viewerYawRadians: number,
): number {
  const yawDeg = (viewerYawRadians * 180) / Math.PI;
  return normalizeHeadingDegrees(yawDeg - poseHeadingDegrees) ?? 0;
}

export function headingCardinal(degrees: number): "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" {
  const d = normalizeHeadingDegrees(degrees) ?? 0;
  const idx = Math.round(d / 45) % 8;
  return (["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const)[idx]!;
}
