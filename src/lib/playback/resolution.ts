export const PLAYBACK_RESOLUTIONS = [
  "1080",
  "1440",
  "source",
] as const;

export type PlaybackResolution = (typeof PLAYBACK_RESOLUTIONS)[number];

export const DEFAULT_PLAYBACK_RESOLUTION: PlaybackResolution = "1080";

export function isPlaybackResolution(
  value: unknown,
): value is PlaybackResolution {
  return (
    typeof value === "string" &&
    (PLAYBACK_RESOLUTIONS as readonly string[]).includes(value)
  );
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
