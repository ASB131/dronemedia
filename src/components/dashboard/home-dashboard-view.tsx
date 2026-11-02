"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Image as ImageIcon,
  Map,
  Plane,
  Upload,
} from "lucide-react";

import { RecentFlightPathsMap } from "@/components/dashboard/recent-flight-paths-map";
import { MediaGridSkeleton } from "@/components/ui/skeletons";
import type { DashboardPayload } from "@/lib/dashboard/queries";
import { cn } from "@/lib/utils";

function formatCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatDuration(seconds: number) {
  if (seconds <= 0) return "—";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

function StatBlock({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-card/60 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </p>
      {sub ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}

const quickActions = [
  { label: "Upload", href: "/upload", icon: Upload },
  { label: "Photos", href: "/photos", icon: ImageIcon },
  { label: "Flights", href: "/flights", icon: Plane },
  { label: "Map", href: "/map", icon: Map },
] as const;

export function HomeDashboardView() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/dashboard");
        if (!response.ok) {
          throw new Error("Failed to load dashboard");
        }
        const payload = (await response.json()) as DashboardPayload;
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) setError("Could not load dashboard");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <MediaGridSkeleton />
      </div>
    );
  }

  const { stats, recentFlightPaths } = data;
  const libraryEmpty =
    stats.photoCount +
      stats.videoCount +
      stats.panoramaCount +
      stats.flightCount ===
    0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 p-4 md:p-6 lg:flex-row lg:gap-8">
      <section className="flex w-full shrink-0 flex-col gap-6 lg:w-[min(22rem,100%)]">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Home
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your library at a glance and recent flights on the map.
          </p>
        </div>

        {libraryEmpty ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
            <p className="text-sm font-medium text-foreground">
              Welcome — your library is empty
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Upload drone media to see stats and flight paths here.
            </p>
            <Link
              href="/upload"
              className="mt-4 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Upload files
            </Link>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <StatBlock
            label="Photos"
            value={formatCount(stats.photoCount)}
          />
          <StatBlock
            label="Videos"
            value={formatCount(stats.videoCount)}
          />
          <StatBlock
            label="Panoramas"
            value={formatCount(stats.panoramaCount)}
          />
          <StatBlock
            label="Flights"
            value={formatCount(stats.flightCount)}
          />
        </div>

        <StatBlock
          label="Total flight time"
          value={formatDuration(stats.totalDurationSeconds)}
        />

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Quick actions
          </p>
          <div className="grid grid-cols-2 gap-2">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.href}
                  href={action.href}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border border-border/80 bg-muted/30 px-3 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted/60",
                  )}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  {action.label}
                </Link>
              );
            })}
          </div>
        </div>

      </section>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          Recent flights
        </h2>
        <RecentFlightPathsMap flights={recentFlightPaths} className="flex-1" />
      </section>
    </div>
  );
}
