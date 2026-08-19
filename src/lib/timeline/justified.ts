export const TIMELINE_TILE_GAP = 2;

export type JustifiedCell<T> = {
  item: T;
  width: number;
  height: number;
};

export type JustifiedRow<T> = {
  height: number;
  items: JustifiedCell<T>[];
};

function clampAspect(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 16 / 9;
  return Math.min(4, Math.max(0.2, value));
}

/** Pack items into rows of equal height whose widths follow aspect ratio. */
export function layoutJustifiedRows<T>(
  items: T[],
  getAspect: (item: T) => number,
  containerWidth: number,
  targetRowHeight: number,
  gap = TIMELINE_TILE_GAP,
): JustifiedRow<T>[] {
  const width = Math.max(1, containerWidth);
  const heightTarget = Math.max(80, targetRowHeight);
  const rows: JustifiedRow<T>[] = [];
  let bucket: T[] = [];
  let aspectSum = 0;

  const flush = (stretch: boolean) => {
    if (bucket.length === 0) return;
    const gaps = gap * Math.max(0, bucket.length - 1);
    const available = Math.max(1, width - gaps);
    const natural = aspectSum * heightTarget;
    // Completed rows scale to fill the row. Leftover last rows stay at the
    // target height so 1–2 portraits are not stretched into giant tiles.
    const scale = stretch && natural > 0 ? available / natural : 1;
    const height = Math.min(heightTarget * 1.08, heightTarget * scale);
    const cells = bucket.map((item) => ({
      item,
      width: clampAspect(getAspect(item)) * height,
      height,
    }));
    if (stretch && cells.length > 0) {
      const totalWidth = cells.reduce((sum, cell) => sum + cell.width, 0);
      const drift = available - totalWidth;
      const last = cells[cells.length - 1]!;
      last.width = Math.max(1, last.width + drift);
    }
    rows.push({
      height,
      items: cells,
    });
    bucket = [];
    aspectSum = 0;
  };

  for (const item of items) {
    const aspect = clampAspect(getAspect(item));
    bucket.push(item);
    aspectSum += aspect;
    const gaps = gap * Math.max(0, bucket.length - 1);
    if (aspectSum * heightTarget + gaps >= width) {
      flush(true);
    }
  }
  flush(false);
  return rows;
}

export function timelineRowTargetHeight(containerWidth: number) {
  return Math.round(Math.min(248, Math.max(176, containerWidth * 0.17)));
}

export function justifiedRowsHeight(
  rows: { height: number }[],
  gap = TIMELINE_TILE_GAP,
) {
  if (rows.length === 0) return 0;
  return (
    rows.reduce((sum, row) => sum + row.height, 0) + gap * (rows.length - 1)
  );
}
