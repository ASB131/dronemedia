"use client";

export function AltitudeGraph({
  series,
  currentOffsetMs,
  className,
}: {
  series: Array<{ altitudeMeters: number; offsetMs: number }>;
  currentOffsetMs: number;
  className?: string;
}) {
  if (series.length < 2) {
    return (
      <div
        className={
          className ??
          "flex h-24 items-center justify-center rounded-lg bg-muted/40 text-xs text-muted-foreground"
        }
      >
        No altitude series
      </div>
    );
  }

  const width = 320;
  const height = 72;
  const padX = 10;
  const padY = 10;
  const maxAlt = Math.max(...series.map((p) => p.altitudeMeters), 1);
  const maxT = Math.max(...series.map((p) => p.offsetMs), 1);

  const points = series
    .map((point) => {
      const x = padX + (point.offsetMs / maxT) * (width - padX * 2);
      const y =
        height - padY - (point.altitudeMeters / maxAlt) * (height - padY * 2);
      return `${x},${y}`;
    })
    .join(" ");

  const current = series.reduce((best, point) =>
    point.offsetMs <= currentOffsetMs ? point : best,
  );
  const currentY =
    height - padY - (current.altitudeMeters / maxAlt) * (height - padY * 2);
  const currentX =
    padX + (Math.min(currentOffsetMs, maxT) / maxT) * (width - padX * 2);

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-16 w-full">
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          className="text-foreground/80"
          points={points}
        />
        <circle cx={currentX} cy={currentY} r="3.5" className="fill-primary" />
      </svg>
      <p className="mt-1 text-xs font-medium tabular-nums text-foreground">
        {Math.round(current.altitudeMeters)} m
      </p>
    </div>
  );
}
