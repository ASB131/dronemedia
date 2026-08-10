"use client";

import Link from "next/link";
import { Film } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function formatSeekClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export type PhotoClipContextView = {
  videoId: string;
  videoDisplayName: string;
  seekSeconds: number;
  match: "spatial" | "temporal";
};

/** Callout when a photo was likely captured during a sibling flight clip. */
export function PhotoClipContextCard({
  context,
}: {
  context: PhotoClipContextView;
}) {
  const href = `/assets/${context.videoId}?t=${context.seekSeconds.toFixed(1)}`;
  return (
    <div className="rounded-xl border border-border/80 bg-muted/30 px-3.5 py-3">
      <p className="text-sm font-semibold tracking-tight">Taken during this clip</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Matched to{" "}
        <span className="font-medium text-foreground/90">
          {context.videoDisplayName}
        </span>{" "}
        at {formatSeekClock(context.seekSeconds)}
        {context.match === "spatial" ? " (nearby on path)" : " (by capture time)"}.
      </p>
      <Link
        href={href}
        className={cn(
          buttonVariants({ size: "sm", variant: "outline" }),
          "mt-2.5 gap-1.5",
        )}
      >
        <Film className="size-3.5" />
        Open clip at {formatSeekClock(context.seekSeconds)}
      </Link>
    </div>
  );
}
