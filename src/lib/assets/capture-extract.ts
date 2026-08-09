/**
 * Capture-time helpers used by workers (and optionally the web app).
 * Prefer EXIF / SRT / container metadata over upload time.
 */

/** Parse dates embedded in common camera/drone filenames. */
export function captureDateFromFilename(filename: string): Date | null {
  const base = filename.replace(/\.[^.]+$/, "");

  // 20200923_144114 or 20200923144114
  const compact = /^(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/.exec(base);
  if (compact) {
    const [, y, mo, d, h, mi, s] = compact;
    const date = new Date(
      Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)),
    );
    if (!Number.isNaN(date.getTime())) return date;
  }

  // DJI_20250907034945_0315_D.MP4 style
  const dji = /(?:^|_)(20\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:_|$)/.exec(
    base,
  );
  if (dji) {
    const [, y, mo, d, h, mi, s] = dji;
    const date = new Date(
      Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)),
    );
    if (!Number.isNaN(date.getTime())) return date;
  }

  // 2025-09-07_03-49-45
  const dashed =
    /^(20\d{2})-(\d{2})-(\d{2})[ _](\d{2})[-:](\d{2})[-:](\d{2})/.exec(base);
  if (dashed) {
    const [, y, mo, d, h, mi, s] = dashed;
    const date = new Date(
      Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)),
    );
    if (!Number.isNaN(date.getTime())) return date;
  }

  return null;
}

export function parseSrtWallClock(value: string): Date | null {
  const match =
    /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(
      value,
    );
  if (!match) return null;
  const [, y, mo, d, h, mi, s, ms = "0"] = match;
  const millis = Number(ms.padEnd(3, "0").slice(0, 3));
  const date = new Date(
    Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s),
      millis,
    ),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}
