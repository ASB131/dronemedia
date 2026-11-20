export function formatTripDateRange(startDate: string, endDate: string) {
  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
  const start = fmt.format(new Date(`${startDate}T12:00:00.000Z`));
  const end = fmt.format(new Date(`${endDate}T12:00:00.000Z`));
  if (startDate === endDate) return start;
  return `${start} – ${end}`;
}

/** Inclusive day count for display. */
export function tripDayCount(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}