import type { TimelineSectionDto } from "@/lib/assets/timeline";

export type TimelineVirtualItem =
  | { type: "year"; key: string; year: number }
  | { type: "month"; key: string; year: number; monthLabel: string }
  | { type: "section"; key: string; section: TimelineSectionDto };

export function buildTimelineVirtualItems(
  sections: TimelineSectionDto[],
): TimelineVirtualItem[] {
  const items: TimelineVirtualItem[] = [];
  let lastYear: number | null = null;
  let lastMonthKey: string | null = null;

  for (const section of sections) {
    if (section.year !== lastYear) {
      items.push({
        type: "year",
        key: `year-${section.year}`,
        year: section.year,
      });
      lastYear = section.year;
      lastMonthKey = null;
    }

    const monthKey = `${section.year}-${section.month}`;
    if (monthKey !== lastMonthKey) {
      items.push({
        type: "month",
        key: `month-${monthKey}`,
        year: section.year,
        monthLabel: section.monthLabel,
      });
      lastMonthKey = monthKey;
    }

    items.push({
      type: "section",
      key: `section-${section.key}`,
      section,
    });
  }

  return items;
}
