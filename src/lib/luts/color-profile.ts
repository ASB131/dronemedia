import type { MediaMetadata } from "@/lib/assets/media-metadata";

export type LutColorProfile = "d_log" | "d_logm";

export const LUT_COLOR_PROFILES: LutColorProfile[] = ["d_log", "d_logm"];

/** Map stored / SRT color_md strings onto supported LUT profiles. */
export function normalizeVideoColorMode(
  raw: string | null | undefined,
): LutColorProfile | null {
  if (!raw) return null;
  const n = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
  if (n === "d_log" || n === "dlog") return "d_log";
  if (n === "d_logm" || n === "dlogm" || n === "d_log_m") return "d_logm";
  return null;
}

export function colorModeFromMediaMetadata(
  meta: MediaMetadata | null | undefined,
): LutColorProfile | null {
  if (!meta) return null;
  if (meta.kind === "video") return normalizeVideoColorMode(meta.colorMode);
  if ("colorMode" in meta) {
    return normalizeVideoColorMode(
      (meta as { colorMode?: string | null }).colorMode,
    );
  }
  return null;
}

export function lutColorProfileLabel(profile: LutColorProfile): string {
  return profile === "d_logm" ? "D-Log M" : "D-Log";
}
