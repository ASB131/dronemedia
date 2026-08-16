/**
 * Site-wide HLS preview ladder and user playback quality preferences.
 */

export const HLS_PREVIEW_HEIGHTS = [720, 1080, 1440] as const;

export type HlsPreviewHeight = (typeof HLS_PREVIEW_HEIGHTS)[number];

export const PLAYBACK_RESOLUTIONS = [
  "720",
  "1080",
  "1440",
  "source",
] as const;

export type PlaybackResolution = (typeof PLAYBACK_RESOLUTIONS)[number];

export const DEFAULT_PLAYBACK_RESOLUTION: PlaybackResolution = "1080";

export function isHlsPreviewHeight(value: unknown): value is HlsPreviewHeight {
  return (
    typeof value === "number" &&
    (HLS_PREVIEW_HEIGHTS as readonly number[]).includes(value)
  );
}

export function isPlaybackResolution(
  value: unknown,
): value is PlaybackResolution {
  return (
    typeof value === "string" &&
    (PLAYBACK_RESOLUTIONS as readonly string[]).includes(value)
  );
}

/** Normalize config heights to the supported preview set, sorted ascending. */
export function normalizeHlsPreviewHeights(
  heights: number[] | null | undefined,
): HlsPreviewHeight[] {
  const allowed = new Set<HlsPreviewHeight>();
  for (const raw of heights ?? []) {
    if (isHlsPreviewHeight(raw)) allowed.add(raw);
  }
  return HLS_PREVIEW_HEIGHTS.filter((height) => allowed.has(height));
}

export function heightFromPlaybackResolution(
  resolution: PlaybackResolution,
): number | null {
  if (resolution === "source") return null;
  const n = Number(resolution);
  return Number.isFinite(n) ? n : null;
}

/**
 * If the user's preferred quality was disabled, fall back to the next preview
 * (prefer lower, then higher). Never falls back to Source unless no previews
 * remain and Source is allowed.
 */
export function coercePlaybackResolution(
  preferred: unknown,
  enabledHeights: number[],
  allowSource: boolean,
): PlaybackResolution {
  const enabled = normalizeHlsPreviewHeights(enabledHeights);
  const preferredRes = isPlaybackResolution(preferred) ? preferred : null;

  if (preferredRes === "source") {
    if (allowSource) return "source";
    // Source disabled — pick highest remaining preview.
    if (enabled.length > 0) {
      return String(enabled[enabled.length - 1]!) as PlaybackResolution;
    }
    return DEFAULT_PLAYBACK_RESOLUTION;
  }

  if (preferredRes != null) {
    const height = Number(preferredRes);
    if (enabled.includes(height as HlsPreviewHeight)) {
      return preferredRes;
    }
    const lower = [...enabled].filter((h) => h < height).sort((a, b) => b - a);
    if (lower[0] != null) {
      return String(lower[0]) as PlaybackResolution;
    }
    const higher = [...enabled].filter((h) => h > height).sort((a, b) => a - b);
    if (higher[0] != null) {
      return String(higher[0]) as PlaybackResolution;
    }
  }

  if (enabled.length > 0) {
    return String(enabled[enabled.length - 1]!) as PlaybackResolution;
  }
  if (allowSource) return "source";
  return DEFAULT_PLAYBACK_RESOLUTION;
}

/** Pick the highest HLS level at or below the preferred height. */
export function pickHlsLevelForHeight(
  levels: Array<{ index: number; height: number }>,
  preferredHeight: number,
): number | null {
  if (levels.length === 0) return null;
  let best: { index: number; height: number } | null = null;
  for (const level of levels) {
    if (level.height <= 0) continue;
    if (level.height > preferredHeight) continue;
    if (!best || level.height > best.height) best = level;
  }
  if (best) return best.index;
  // Prefer closest above if nothing fits below (e.g. only 1440 available, want 720).
  let closest = levels[0]!;
  for (const level of levels) {
    if (level.height <= 0) continue;
    if (
      Math.abs(level.height - preferredHeight) <
      Math.abs(closest.height - preferredHeight)
    ) {
      closest = level;
    }
  }
  return closest.index;
}
