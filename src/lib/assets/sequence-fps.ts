/** Allowed fps presets shown in the sequence detail UI. */
export const SEQUENCE_FPS_PRESETS = [12, 15, 18, 24, 25, 30, 48, 60] as const;

export const SEQUENCE_FPS_MIN = 1;
export const SEQUENCE_FPS_MAX = 120;

export function clampSequenceFps(value: number): number {
  if (!Number.isFinite(value)) return 24;
  const rounded = Math.round(value * 100) / 100;
  return Math.min(SEQUENCE_FPS_MAX, Math.max(SEQUENCE_FPS_MIN, rounded));
}

export function formatSequenceDuration(
  frameCount: number | null | undefined,
  fps: number | null | undefined,
): string | null {
  if (!frameCount || !fps || fps <= 0) return null;
  const seconds = frameCount / fps;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds - minutes * 60;
  return `${minutes}m ${rem.toFixed(0)}s`;
}
