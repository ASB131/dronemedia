import type { assets } from "@/lib/db/schema";

export type AssetRow = typeof assets.$inferSelect;

export function getEffectiveCaptureDate(asset: {
  capturedAtOverride: Date | null;
  capturedAtOriginal: Date | null;
  createdAt: Date;
}): Date {
  return (
    asset.capturedAtOverride ??
    asset.capturedAtOriginal ??
    asset.createdAt
  );
}

export function getCaptureTimezone(asset: {
  capturedTimezone: string | null;
}): string {
  return asset.capturedTimezone ?? "UTC";
}

export type CaptureLocalParts = {
  year: number;
  month: number;
  day: number;
  monthLabel: string;
  dateLabel: string;
  yearLabel: string;
};

export function getCaptureLocalParts(
  date: Date,
  timeZone: string,
): CaptureLocalParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = dtf.formatToParts(date);
  const lookup = Object.fromEntries(
    parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );

  const year = Number(lookup.year);
  const month = Number(lookup.month);
  const day = Number(lookup.day);

  const monthLabel = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
  }).format(date);

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);

  return { year, month, day, monthLabel, dateLabel, yearLabel: String(year) };
}

export function getMonthDayKey(parts: Pick<CaptureLocalParts, "month" | "day">) {
  return `${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}
