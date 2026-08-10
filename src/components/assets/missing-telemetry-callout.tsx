"use client";

import Link from "next/link";
import { AlertTriangle, MapPinOff, Upload } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function MissingTelemetryCallout({
  kind,
  hasSrt,
  parseStatus,
  hasLocation,
  hasFlightPath,
  hasSeries,
  uploadHref = "/upload",
}: {
  kind: "video" | "photo" | "sequence";
  hasSrt: boolean;
  parseStatus: string | null;
  hasLocation: boolean;
  hasFlightPath: boolean;
  hasSeries: boolean;
  uploadHref?: string;
}) {
  const isClip = kind === "video" || kind === "sequence";
  const items: Array<{
    key: string;
    title: string;
    body: string;
    cta?: { label: string; href: string };
    icon: "srt" | "gps";
  }> = [];

  if (isClip && !hasSrt) {
    items.push({
      key: "no-srt",
      title: "No SRT telemetry",
      body: "Upload a matching .srt (same basename as the video) to plot the flight path and unlock the live HUD.",
      cta: { label: "Pair SRT", href: uploadHref },
      icon: "srt",
    });
  } else if (
    isClip &&
    hasSrt &&
    (parseStatus === "failed" || parseStatus === "unparsed")
  ) {
    items.push({
      key: "srt-pending",
      title: parseStatus === "failed" ? "SRT parse failed" : "SRT not parsed yet",
      body:
        parseStatus === "failed"
          ? "The subtitle file was found but GPS cues could not be read. Re-upload a DJI-style .srt or check the file."
          : "Telemetry is queued. The path and altitude graph will appear after processing finishes.",
      cta: { label: "Re-upload SRT", href: uploadHref },
      icon: "srt",
    });
  } else if (isClip && hasSrt && !hasFlightPath && !hasSeries) {
    items.push({
      key: "weak-telemetry",
      title: "Weak or empty telemetry",
      body: "An SRT is attached but no usable GPS track was produced. Try pairing a fuller .srt from the same flight.",
      cta: { label: "Pair SRT", href: uploadHref },
      icon: "srt",
    });
  }

  if (!hasLocation && !hasFlightPath) {
    items.push({
      key: "no-gps",
      title: "No GPS location",
      body: isClip
        ? "This clip has no coordinates yet. Pairing SRT usually fills the map once cues include latitude/longitude."
        : "This photo has no geotag. Photos near a flight are often linked automatically when GPS is present.",
      icon: "gps",
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.key}
          className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3.5 py-3"
        >
          <div className="flex gap-2.5">
            {item.icon === "srt" ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            ) : (
              <MapPinOff className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold tracking-tight">{item.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{item.body}</p>
              {item.cta ? (
                <Link
                  href={item.cta.href}
                  className={cn(
                    buttonVariants({ size: "sm", variant: "outline" }),
                    "mt-2.5 gap-1.5",
                  )}
                >
                  <Upload className="size-3.5" />
                  {item.cta.label}
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
