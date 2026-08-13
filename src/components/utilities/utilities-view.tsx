"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CheckSquare,
  Copy,
  Download,
  ExternalLink,
  Film,
  HardDrive,
  Heart,
  ImageIcon,
  ListOrdered,
  MapPin,
  RefreshCw,
  ScanSearch,
  Square,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DuplicateGroupDto, LargeFileDto } from "@/lib/assets/mutations";
import { assetThumbnailSrc } from "@/lib/assets/thumbnails";
import type { JobsStatusDto, JobListItemDto } from "@/lib/jobs/status";
import type { UploadStagingStatusDto } from "@/lib/upload/staging-status";
import { cn } from "@/lib/utils";

const tabs = [
  { id: "duplicates", label: "Duplicates", icon: Copy },
  { id: "large", label: "Large files", icon: HardDrive },
  { id: "location", label: "Location", icon: MapPin },
  { id: "jobs", label: "Jobs", icon: Activity },
] as const;

type LocatedAssetDto = {
  id: string;
  displayName: string;
  assetType: "photo" | "video" | "sequence";
  lat: number | null;
  lng: number | null;
  hasOverride: boolean;
};

const JOBS_POLL_MS = 1500;

type TabId = (typeof tabs)[number]["id"];
type DuplicateKind = "exact" | "near";
type JobSection = "active" | "waiting" | "delayed" | "failed" | "completed";

function formatBytes(bytes: number | null) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatWhen(timestamp: string | null) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function shortHash(hash: string) {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}

function stateTone(state: JobListItemDto["state"]) {
  switch (state) {
    case "active":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    case "waiting":
      return "bg-sky-500/15 text-sky-700 dark:text-sky-300";
    case "delayed":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    case "failed":
      return "bg-destructive/15 text-destructive";
    case "completed":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function UtilitiesView() {
  const [tab, setTab] = useState<TabId>("duplicates");
  const [duplicateKind, setDuplicateKind] = useState<DuplicateKind>("exact");
  const [loading, setLoading] = useState(false);
  const [largeFiles, setLargeFiles] = useState<LargeFileDto[]>([]);
  const [locatedAssets, setLocatedAssets] = useState<LocatedAssetDto[]>([]);
  const [locationDrafts, setLocationDrafts] = useState<
    Record<string, { lat: string; lng: string }>
  >({});
  const [busyLocationId, setBusyLocationId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobsStatusDto | null>(null);
  const [deferredJobs, setDeferredJobs] = useState<
    Array<{
      assetId: string;
      assetName: string;
      job: string;
      reason: string;
    }>
  >([]);
  const [staging, setStaging] = useState<UploadStagingStatusDto | null>(null);
  const [jobSection, setJobSection] = useState<JobSection>("active");
  const [jobsLive, setJobsLive] = useState(false);
  const [jobsRefreshing, setJobsRefreshing] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const jobsInFlight = useRef(false);
  const jobSectionTouched = useRef(false);
  const [duplicates, setDuplicates] = useState<{
    exactHash: DuplicateGroupDto[];
    perceptualHash: DuplicateGroupDto[];
  } | null>(null);
  const [hashAlgorithm, setHashAlgorithm] = useState<string | null>(null);
  const [onDuplicate, setOnDuplicate] = useState<string | null>(null);
  const [selectedByGroup, setSelectedByGroup] = useState<
    Record<string, string[]>
  >({});
  const [selectedLarge, setSelectedLarge] = useState<Set<string>>(new Set());
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const [busyLarge, setBusyLarge] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [hiddenFinishedJobKeys, setHiddenFinishedJobKeys] = useState<
    Set<string>
  >(() => new Set());

  async function refreshJobs(options?: { quiet?: boolean }) {
    if (jobsInFlight.current) return;
    jobsInFlight.current = true;
    if (!options?.quiet) setJobsRefreshing(true);
    try {
      const response = await fetch("/api/utilities?view=jobs", {
        cache: "no-store",
      });
      if (!response.ok) {
        if (!options?.quiet) setMessage("Failed to load jobs");
        return;
      }
      const payload = (await response.json()) as {
        jobs: JobsStatusDto;
        deferred?: Array<{
          assetId: string;
          assetName: string;
          job: string;
          reason: string;
        }>;
        staging?: UploadStagingStatusDto;
      };
      setJobs(payload.jobs);
      setDeferredJobs(payload.deferred ?? []);
      setStaging(payload.staging ?? null);
      if (!jobSectionTouched.current) {
        if (payload.jobs.active.length > 0) setJobSection("active");
        else if (payload.jobs.waiting.length > 0) setJobSection("waiting");
        else if (payload.jobs.failed.length > 0) setJobSection("failed");
        else if (payload.jobs.completed.length > 0) setJobSection("completed");
      }
    } finally {
      jobsInFlight.current = false;
      setJobsRefreshing(false);
    }
  }

  async function loadTab(nextTab: TabId = tab) {
    setLoading(true);
    setMessage(null);
    try {
      if (nextTab === "large") {
        const response = await fetch("/api/utilities?view=large");
        if (!response.ok) return;
        const payload = (await response.json()) as {
          assets: LargeFileDto[];
        };
        setLargeFiles(payload.assets);
        setSelectedLarge(new Set());
      } else if (nextTab === "location") {
        const response = await fetch("/api/utilities?view=location");
        if (!response.ok) return;
        const payload = (await response.json()) as {
          assets: LocatedAssetDto[];
        };
        setLocatedAssets(payload.assets);
        const drafts: Record<string, { lat: string; lng: string }> = {};
        for (const asset of payload.assets) {
          drafts[asset.id] = {
            lat: asset.lat != null ? String(asset.lat) : "",
            lng: asset.lng != null ? String(asset.lng) : "",
          };
        }
        setLocationDrafts(drafts);
      } else if (nextTab === "jobs") {
        await refreshJobs();
      } else {
        const response = await fetch("/api/utilities?view=duplicates");
        if (!response.ok) return;
        const payload = (await response.json()) as {
          duplicates: NonNullable<typeof duplicates>;
          algorithm?: string;
          onDuplicate?: string;
        };
        setDuplicates(payload.duplicates);
        setHashAlgorithm(payload.algorithm ?? null);
        setOnDuplicate(payload.onDuplicate ?? null);
        setSelectedByGroup({});
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTab(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Live jobs: fast poll + SSE push when job notifications fire.
  useEffect(() => {
    if (tab !== "jobs") {
      setJobsLive(false);
      return;
    }

    let cancelled = false;
    let pollTimer: number | undefined;
    let source: EventSource | null = null;

    const tick = () => {
      if (!cancelled) void refreshJobs({ quiet: true });
    };

    tick();
    pollTimer = window.setInterval(tick, JOBS_POLL_MS);

    try {
      source = new EventSource("/api/notifications/stream");
      source.onopen = () => {
        if (!cancelled) setJobsLive(true);
      };
      source.onerror = () => {
        if (!cancelled) setJobsLive(false);
      };
      source.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as {
            type?: string;
            status?: string;
            jobType?: string;
          };
          if (parsed.type === "heartbeat" || parsed.type === "connected") return;
          if (parsed.jobType || parsed.status) tick();
        } catch {
          // ignore malformed events
        }
      };
    } catch {
      setJobsLive(false);
    }

    return () => {
      cancelled = true;
      if (pollTimer) window.clearInterval(pollTimer);
      source?.close();
      setJobsLive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const groups = useMemo(() => {
    if (!duplicates) return [];
    return duplicateKind === "exact"
      ? duplicates.exactHash
      : duplicates.perceptualHash;
  }, [duplicates, duplicateKind]);

  const exactCount = duplicates?.exactHash.length ?? 0;
  const nearCount = duplicates?.perceptualHash.length ?? 0;
  const largeSelectedCount = selectedLarge.size;

  const jobList = useMemo(() => {
    if (!jobs) return [];
    const list = jobs[jobSection];
    if (jobSection !== "completed") return list;
    return list.filter(
      (job) => !hiddenFinishedJobKeys.has(`${job.queue}:${job.id}`),
    );
  }, [jobs, jobSection, hiddenFinishedJobKeys]);

  function clearFinishedFromList() {
    if (!jobs) return;
    setHiddenFinishedJobKeys((prev) => {
      const next = new Set(prev);
      for (const job of jobs.completed) {
        next.add(`${job.queue}:${job.id}`);
      }
      return next;
    });
    setMessage("Cleared finished jobs from this list (session only)");
  }

  function toggleSelect(groupKey: string, assetId: string) {
    setSelectedByGroup((current) => {
      const existing = current[groupKey] ?? [];
      const next = existing.includes(assetId)
        ? existing.filter((id) => id !== assetId)
        : [...existing, assetId];
      return { ...current, [groupKey]: next };
    });
  }

  function selectAllButOne(group: DuplicateGroupDto, keepId: string) {
    const key = `${duplicateKind}:${group.hash}`;
    setSelectedByGroup((current) => ({
      ...current,
      [key]: group.assets
        .map((asset) => asset.id)
        .filter((id) => id !== keepId),
    }));
  }

  function toggleLarge(id: string) {
    setSelectedLarge((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteSelectedDuplicates(group: DuplicateGroupDto) {
    const key = `${duplicateKind}:${group.hash}`;
    const selected = selectedByGroup[key] ?? [];
    if (selected.length === 0) {
      setMessage("Select items to delete");
      return;
    }
    if (selected.length >= group.assets.length) {
      setMessage("Keep at least one item in the group");
      return;
    }
    if (
      !confirm(
        `Permanently delete ${selected.length} duplicate${selected.length === 1 ? "" : "s"}?\n\nThis removes originals plus thumbnails, previews, HLS, and other cache for those items. This cannot be undone.`,
      )
    ) {
      return;
    }

    setBusyGroup(key);
    setMessage(null);
    const response = await fetch("/api/assets/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds: selected, action: "purge" }),
    });
    setBusyGroup(null);
    if (!response.ok) {
      setMessage("Failed to delete selected duplicates");
      return;
    }
    const payload = (await response.json().catch(() => null)) as {
      purged?: number;
    } | null;
    setMessage(
      `Deleted ${payload?.purged ?? selected.length} duplicate${(payload?.purged ?? selected.length) === 1 ? "" : "s"} (media + cache)`,
    );
    setSelectedByGroup((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    await loadTab("duplicates");
  }

  async function keepBoth(group: DuplicateGroupDto) {
    const key = `${duplicateKind}:${group.hash}`;
    const assetIds = group.assets?.length
      ? group.assets.map((asset) => asset.id)
      : group.assetIds;
    setBusyGroup(key);
    setMessage(null);
    const response = await fetch("/api/utilities/duplicates/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: duplicateKind,
        hash: group.hash,
        assetIds,
      }),
    });
    setBusyGroup(null);
    if (!response.ok) {
      setMessage(
        duplicateKind === "exact"
          ? "Failed to keep both"
          : "Failed to dismiss near-duplicates",
      );
      return;
    }
    setMessage(
      duplicateKind === "exact"
        ? "Kept both — intentional duplicates dismissed"
        : "Marked as not duplicates",
    );
    await loadTab("duplicates");
  }

  async function binLargeSelected() {
    const ids = [...selectedLarge];
    if (ids.length === 0) return;
    if (
      !confirm(
        `Move ${ids.length} file${ids.length === 1 ? "" : "s"} to the bin?`,
      )
    ) {
      return;
    }
    setBusyLarge(true);
    setMessage(null);
    const response = await fetch("/api/assets/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds: ids, action: "bin" }),
    });
    setBusyLarge(false);
    if (!response.ok) {
      setMessage("Failed to bin selected files");
      return;
    }
    setMessage(`Moved ${ids.length} item${ids.length === 1 ? "" : "s"} to the bin`);
    await loadTab("large");
  }

  async function toggleFavorite(asset: LargeFileDto) {
    setBusyLarge(true);
    setMessage(null);
    const response = await fetch(`/api/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite: !asset.favorite }),
    });
    setBusyLarge(false);
    if (!response.ok) {
      setMessage("Failed to update favorite");
      return;
    }
    setLargeFiles((current) =>
      current.map((row) =>
        row.id === asset.id ? { ...row, favorite: !row.favorite } : row,
      ),
    );
  }

  async function binOne(assetId: string) {
    if (!confirm("Move this file to the bin?")) return;
    setBusyLarge(true);
    setMessage(null);
    const response = await fetch("/api/assets/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds: [assetId], action: "bin" }),
    });
    setBusyLarge(false);
    if (!response.ok) {
      setMessage("Failed to bin file");
      return;
    }
    setMessage("Moved to bin");
    await loadTab("large");
  }

  async function saveLocation(assetId: string) {
    const draft = locationDrafts[assetId];
    if (!draft) return;
    const lat = Number(draft.lat);
    const lng = Number(draft.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setMessage("Enter valid lat/lng numbers");
      return;
    }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      setMessage("Lat must be ±90 and lng ±180");
      return;
    }
    setBusyLocationId(assetId);
    setMessage(null);
    const response = await fetch(`/api/assets/${assetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationOverride: { lat, lng } }),
    });
    setBusyLocationId(null);
    if (!response.ok) {
      setMessage("Failed to update location");
      return;
    }
    setMessage("Location updated");
    await loadTab("location");
  }

  async function clearLocation(assetId: string) {
    setBusyLocationId(assetId);
    setMessage(null);
    const response = await fetch(`/api/assets/${assetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationOverride: null }),
    });
    setBusyLocationId(null);
    if (!response.ok) {
      setMessage("Failed to clear override");
      return;
    }
    setMessage("Location override cleared");
    await loadTab("location");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Utilities</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Clean up duplicates, edit locations, inspect large files, and
              monitor background jobs
            </p>
          </div>
          <div className="flex items-center gap-2">
            {tab === "duplicates" && duplicates ? (
              <p className="text-xs text-muted-foreground">
                {exactCount} exact group{exactCount === 1 ? "" : "s"}
                {" · "}
                {nearCount} near-duplicate group{nearCount === 1 ? "" : "s"}
                {hashAlgorithm
                  ? ` · hash ${hashAlgorithm}${onDuplicate ? ` · onDup ${onDuplicate}` : ""}`
                  : ""}
              </p>
            ) : null}
            {tab === "jobs" ? (
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
                    jobsLive
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      jobsLive ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/50",
                    )}
                  />
                  {jobsLive ? "Live" : "Polling"}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={jobsRefreshing}
                  onClick={() => void refreshJobs()}
                >
                  <RefreshCw
                    className={cn(
                      "size-3.5",
                      jobsRefreshing && "animate-spin",
                    )}
                  />
                  Refresh
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!jobs || jobs.completed.length === 0}
                  onClick={clearFinishedFromList}
                  title="Hides completed rows in this browser session. Does not cancel jobs."
                >
                  Clear finished from list
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={recoveryBusy}
                  title="Clears Possible duplicate descriptions that were false flags from shared SRT/LRF"
                  onClick={() => {
                    void (async () => {
                      setRecoveryBusy(true);
                      try {
                        const response = await fetch("/api/utilities", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            action: "clearFalseDuplicateFlags",
                          }),
                        });
                        if (!response.ok) {
                          setMessage("Failed to clear false duplicate flags");
                          return;
                        }
                        const payload = (await response.json()) as {
                          cleared?: number;
                        };
                        setMessage(
                          `Cleared ${payload.cleared ?? 0} false duplicate flag${(payload.cleared ?? 0) === 1 ? "" : "s"}`,
                        );
                      } finally {
                        setRecoveryBusy(false);
                      }
                    })();
                  }}
                >
                  Clear false duplicate flags
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={recoveryBusy}
                  title="Deletes cached thumbs and requeues thumbnail jobs (up to 200 assets)"
                  onClick={() => {
                    void (async () => {
                      setRecoveryBusy(true);
                      try {
                        const response = await fetch("/api/utilities", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            action: "requeueThumbnails",
                            missingOnly: false,
                            limit: 200,
                          }),
                        });
                        if (!response.ok) {
                          setMessage("Failed to requeue thumbnails");
                          return;
                        }
                        const payload = (await response.json()) as {
                          queued?: number;
                        };
                        setMessage(
                          `Queued ${payload.queued ?? 0} thumbnail job${(payload.queued ?? 0) === 1 ? "" : "s"}`,
                        );
                        await refreshJobs({ quiet: true });
                      } finally {
                        setRecoveryBusy(false);
                      }
                    })();
                  }}
                >
                  Requeue thumbnails
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {tabs.map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition",
                  tab === entry.id
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {entry.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {message ? (
          <p className="mb-4 text-sm text-muted-foreground">{message}</p>
        ) : null}
        {loading && tab === "duplicates" && !duplicates ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : null}

        {tab === "duplicates" && duplicates ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setDuplicateKind("exact")}
                className={cn(
                  "h-8 rounded-full px-3 text-xs font-medium",
                  duplicateKind === "exact"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                Exact hash ({exactCount})
              </button>
              <button
                type="button"
                onClick={() => setDuplicateKind("near")}
                className={cn(
                  "h-8 rounded-full px-3 text-xs font-medium",
                  duplicateKind === "near"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                Near duplicates ({nearCount})
              </button>
              {hashAlgorithm ? (
                <p className="ml-auto text-xs text-muted-foreground">
                  Content hash: <span className="font-medium">{hashAlgorithm}</span>
                  {onDuplicate ? ` · on duplicate: ${onDuplicate}` : ""}
                </p>
              ) : null}
            </div>

            {groups.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
                <ScanSearch className="size-8 text-muted-foreground/70" />
                <p className="text-sm font-medium">
                  {duplicateKind === "exact"
                    ? "No exact duplicates found"
                    : "No near-duplicates found"}
                </p>
                <p className="max-w-md text-xs text-muted-foreground">
                  {duplicateKind === "exact"
                    ? "Exact matches use content hashes from uploaded files."
                    : "Near-duplicates group photos within Hamming distance 8 of each other."}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {groups.map((group) => {
                  const groupKey = `${duplicateKind}:${group.hash}`;
                  const selected = selectedByGroup[groupKey] ?? [];
                  const members = group.assets?.length
                    ? group.assets
                    : group.assetIds.map((id, index) => ({
                        id,
                        displayName: group.displayNames[index] ?? id,
                        assetType: "photo" as const,
                        fileSizeBytes: null,
                      }));

                  return (
                    <section
                      key={groupKey}
                      className="overflow-hidden rounded-2xl border border-border bg-card"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold">
                            {members.length} matching item
                            {members.length === 1 ? "" : "s"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {duplicateKind === "exact" ? "Exact" : "Perceptual"}{" "}
                            · {shortHash(group.hash)}
                            {selected.length > 0
                              ? ` · ${selected.length} selected`
                              : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyGroup === groupKey}
                            onClick={() => void keepBoth(group)}
                          >
                            {duplicateKind === "exact"
                              ? "Keep both"
                              : "Not duplicates"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyGroup === groupKey}
                            onClick={() =>
                              selectAllButOne(group, members[0]!.id)
                            }
                          >
                            Keep first, select rest
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={
                              busyGroup === groupKey || selected.length === 0
                            }
                            onClick={() => void deleteSelectedDuplicates(group)}
                          >
                            <Trash2 className="size-3.5" />
                            Delete selected
                          </Button>
                        </div>
                      </div>

                      <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {members.map((asset) => {
                          const isSelected = selected.includes(asset.id);
                          return (
                            <div
                              key={asset.id}
                              className={cn(
                                "overflow-hidden rounded-xl border bg-background transition",
                                isSelected
                                  ? "border-destructive/50 ring-2 ring-destructive/25"
                                  : "border-border",
                              )}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  toggleSelect(groupKey, asset.id)
                                }
                                className="relative block aspect-[4/3] w-full bg-muted"
                                title={
                                  isSelected
                                    ? "Deselect"
                                    : "Select for binning"
                                }
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={assetThumbnailSrc(asset.id)}
                                  alt=""
                                  className="size-full object-cover"
                                />
                                <span className="absolute left-2 top-2 rounded-full bg-black/65 px-2 py-0.5 text-[11px] text-white">
                                  {isSelected ? "Selected" : "Tap to select"}
                                </span>
                                <span className="absolute bottom-2 left-2 rounded bg-black/65 p-1 text-white">
                                  {asset.assetType === "video" ? (
                                    <Film className="size-3.5" />
                                  ) : (
                                    <ImageIcon className="size-3.5" />
                                  )}
                                </span>
                              </button>
                              <div className="space-y-2 p-2.5">
                                <p className="truncate text-sm font-medium">
                                  {asset.displayName}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {formatBytes(asset.fileSizeBytes)}
                                </p>
                                <div className="flex gap-2">
                                  <Link
                                    href={`/assets/${asset.id}`}
                                    className="inline-flex h-7 flex-1 items-center justify-center rounded-lg border border-border text-xs font-medium hover:bg-muted"
                                  >
                                    Open
                                  </Link>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="flex-1"
                                    onClick={() =>
                                      selectAllButOne(group, asset.id)
                                    }
                                  >
                                    Keep this
                                  </Button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {tab === "large" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Largest files first
                {largeFiles.length > 0 ? ` · ${largeFiles.length} shown` : ""}
                {largeSelectedCount > 0
                  ? ` · ${largeSelectedCount} selected`
                  : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={largeFiles.length === 0}
                  onClick={() =>
                    setSelectedLarge(new Set(largeFiles.map((a) => a.id)))
                  }
                >
                  Select all
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={largeSelectedCount === 0}
                  onClick={() => setSelectedLarge(new Set())}
                >
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busyLarge || largeSelectedCount === 0}
                  onClick={() => void binLargeSelected()}
                >
                  <Trash2 className="size-3.5" />
                  Bin selected
                </Button>
              </div>
            </div>

            {loading && largeFiles.length === 0 ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : largeFiles.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
                <HardDrive className="size-8 text-muted-foreground/70" />
                <p className="text-sm text-muted-foreground">No assets found</p>
              </div>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                {largeFiles.map((asset) => {
                  const selected = selectedLarge.has(asset.id);
                  return (
                    <li
                      key={asset.id}
                      className={cn(
                        "flex flex-wrap items-center gap-3 px-3 py-2.5 transition",
                        selected && "bg-primary/5",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleLarge(asset.id)}
                        className="inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground"
                        aria-label={selected ? "Deselect" : "Select"}
                      >
                        {selected ? (
                          <CheckSquare className="size-4 text-primary" />
                        ) : (
                          <Square className="size-4" />
                        )}
                      </button>

                      <Link
                        href={`/assets/${asset.id}`}
                        className="relative size-12 shrink-0 overflow-hidden rounded-md bg-muted"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={assetThumbnailSrc(asset.id)}
                          alt=""
                          className="size-full object-cover"
                          loading="lazy"
                        />
                        <span className="absolute bottom-0.5 left-0.5 rounded bg-black/65 p-0.5 text-white">
                          {asset.assetType === "video" ? (
                            <Film className="size-2.5" />
                          ) : (
                            <ImageIcon className="size-2.5" />
                          )}
                        </span>
                      </Link>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <p className="truncate text-sm font-medium">
                            {asset.displayName}
                          </p>
                          {asset.favorite ? (
                            <Heart className="size-3 fill-[#ed79b5] text-[#ed79b5]" />
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          <span className="font-medium tabular-nums text-foreground">
                            {formatBytes(asset.fileSizeBytes)}
                          </span>
                          {" · "}
                          {asset.mainFileExt.toUpperCase()}
                          {" · "}
                          {asset.assetType}
                          {asset.hasSrt ? " · SRT" : ""}
                          {asset.hasLrf ? " · LRF" : ""}
                          {" · "}
                          Captured {formatWhen(asset.capturedAt)}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        <Link
                          href={`/assets/${asset.id}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-muted"
                        >
                          <ExternalLink className="size-3.5" />
                          Open
                        </Link>
                        <a
                          href={`/api/assets/${asset.id}/download`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-muted"
                        >
                          <Download className="size-3.5" />
                          Download
                        </a>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyLarge}
                          onClick={() => void toggleFavorite(asset)}
                        >
                          <Heart
                            className={cn(
                              "size-3.5",
                              asset.favorite && "fill-[#ed79b5] text-[#ed79b5]",
                            )}
                          />
                          {asset.favorite ? "Unfavorite" : "Favorite"}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busyLarge}
                          onClick={() => void binOne(asset.id)}
                        >
                          <Trash2 className="size-3.5" />
                          Bin
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        {tab === "location" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Geotagged assets
              {locatedAssets.length > 0
                ? ` · ${locatedAssets.length} shown`
                : ""}
            </p>
            {loading && locatedAssets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : locatedAssets.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
                <MapPin className="size-8 text-muted-foreground/70" />
                <p className="text-sm text-muted-foreground">
                  No located assets yet
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                {locatedAssets.map((asset) => {
                  const draft = locationDrafts[asset.id] ?? {
                    lat: "",
                    lng: "",
                  };
                  const busy = busyLocationId === asset.id;
                  return (
                    <li
                      key={asset.id}
                      className="flex flex-wrap items-center gap-2 px-3 py-2"
                    >
                      <Link
                        href={`/assets/${asset.id}`}
                        className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                      >
                        {asset.displayName}
                      </Link>
                      {asset.hasOverride ? (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                          override
                        </span>
                      ) : null}
                      <input
                        type="number"
                        step="any"
                        value={draft.lat}
                        onChange={(event) =>
                          setLocationDrafts((current) => ({
                            ...current,
                            [asset.id]: {
                              ...draft,
                              lat: event.target.value,
                            },
                          }))
                        }
                        placeholder="Lat"
                        className="w-28 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs tabular-nums"
                      />
                      <input
                        type="number"
                        step="any"
                        value={draft.lng}
                        onChange={(event) =>
                          setLocationDrafts((current) => ({
                            ...current,
                            [asset.id]: {
                              ...draft,
                              lng: event.target.value,
                            },
                          }))
                        }
                        placeholder="Lng"
                        className="w-28 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs tabular-nums"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void saveLocation(asset.id)}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || !asset.hasOverride}
                        onClick={() => void clearLocation(asset.id)}
                      >
                        Clear
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        {tab === "jobs" ? (
          <div className="space-y-4">
            {loading && !jobs ? (
              <p className="text-sm text-muted-foreground">Loading jobs…</p>
            ) : !jobs ? (
              <p className="text-sm text-muted-foreground">No job data</p>
            ) : (
              <>
                {staging &&
                (staging.readyInCache > 0 ||
                  staging.assembling > 0 ||
                  staging.uploading > 0 ||
                  staging.committingBatches.length > 0) ? (
                  <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4">
                    <h3 className="text-sm font-semibold">
                      Upload staging / library transfer
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Files land in cache first, then move into the media
                      library. This shows where your current uploads are.
                    </p>
                    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-xl border border-border/60 bg-background/50 px-3 py-2">
                        <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Uploading
                        </dt>
                        <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                          {staging.uploading}
                        </dd>
                      </div>
                      <div className="rounded-xl border border-border/60 bg-background/50 px-3 py-2">
                        <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Assembling in cache
                        </dt>
                        <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                          {staging.assembling}
                        </dd>
                      </div>
                      <div className="rounded-xl border border-border/60 bg-background/50 px-3 py-2">
                        <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Ready in cache
                        </dt>
                        <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                          {staging.readyInCache}
                        </dd>
                        <dd className="text-[11px] text-muted-foreground">
                          {formatBytes(staging.bytesInCache)} staged
                        </dd>
                      </div>
                      <div className="rounded-xl border border-border/60 bg-background/50 px-3 py-2">
                        <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Moved this round
                        </dt>
                        <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                          {staging.movedToLibrary}
                        </dd>
                      </div>
                    </dl>
                    {staging.committingBatches.length > 0 ? (
                      <ul className="mt-3 space-y-2 text-sm">
                        {staging.committingBatches.map((batch) => (
                          <li
                            key={batch.batchId}
                            className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border/50 px-3 py-2"
                          >
                            <span className="font-medium">
                              {batch.status === "committing"
                                ? `Moving to library (${batch.moved}/${batch.total})`
                                : `Waiting in cache (${batch.moved}/${batch.total} linked)`}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {batch.bytesRemaining > 0
                                ? `${formatBytes(batch.bytesRemaining)} still in cache`
                                : "Almost done"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {staging.samples.length > 0 ? (
                      <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                        {staging.samples.slice(0, 12).map((file) => (
                          <li
                            key={file.id}
                            className="flex flex-wrap justify-between gap-2"
                          >
                            <span className="truncate font-medium text-foreground/80">
                              {file.displayName}
                            </span>
                            <span>
                              {file.assetId
                                ? "In library"
                                : file.status === "complete"
                                  ? "In cache · waiting to move"
                                  : file.status === "assembling"
                                    ? "Assembling in cache"
                                    : file.batchStatus === "committing"
                                      ? "Moving to library…"
                                      : file.status}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
                {deferredJobs.length > 0 ? (
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
                    <h3 className="text-sm font-semibold">
                      Waiting to process ({deferredJobs.length})
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      These finished import but a heavy job is paused by an
                      administrator. They will queue automatically when the
                      gate is turned back on.
                    </p>
                    <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-sm">
                      {deferredJobs.map((item) => (
                        <li
                          key={`${item.job}-${item.assetId}`}
                          className="flex flex-wrap items-baseline justify-between gap-2"
                        >
                          <Link
                            href={`/assets/${item.assetId}`}
                            className="font-medium hover:underline"
                          >
                            {item.assetName}
                          </Link>
                          <span className="text-xs text-muted-foreground">
                            {item.reason}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {(
                    [
                      {
                        id: "active" as const,
                        label: "Active",
                        value: jobs.totals.active,
                        hint: "Currently running",
                      },
                      {
                        id: "waiting" as const,
                        label: "Queued",
                        value: jobs.totals.waiting,
                        hint: "Waiting to run",
                      },
                      {
                        id: "delayed" as const,
                        label: "Delayed",
                        value: jobs.totals.delayed,
                        hint: "Scheduled / retry backoff",
                      },
                      {
                        id: "failed" as const,
                        label: "Failed",
                        value: jobs.totals.failed,
                        hint: "In queue failed state",
                      },
                      {
                        id: "completed" as const,
                        label: "Recent done",
                        value: jobs.completed.length,
                        hint: "Latest completed jobs",
                      },
                    ] as const
                  ).map((card) => (
                    <button
                      key={card.label}
                      type="button"
                      onClick={() => {
                        jobSectionTouched.current = true;
                        setJobSection(card.id);
                      }}
                      className={cn(
                        "rounded-2xl border bg-card px-4 py-3 text-left transition",
                        jobSection === card.id
                          ? "border-foreground/40 ring-2 ring-foreground/10"
                          : "border-border hover:border-foreground/25",
                      )}
                    >
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {card.label}
                      </p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums">
                        {card.value}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {card.hint}
                      </p>
                    </button>
                  ))}
                </div>
                {jobs.fetchedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Updated {formatWhen(jobs.fetchedAt)}
                    {jobs.totals.active + jobs.totals.waiting > 0
                      ? " · processing uploads live"
                      : ""}
                  </p>
                ) : null}

                <section className="overflow-hidden rounded-2xl border border-border bg-card">
                  <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                    <ListOrdered className="size-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-semibold">Queues</p>
                      <p className="text-xs text-muted-foreground">
                        Breakdown by worker queue
                      </p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-4 py-2 font-medium">Queue</th>
                          <th className="px-3 py-2 font-medium">Active</th>
                          <th className="px-3 py-2 font-medium">Waiting</th>
                          <th className="px-3 py-2 font-medium">Delayed</th>
                          <th className="px-3 py-2 font-medium">Failed</th>
                          <th className="px-3 py-2 font-medium">Completed</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {jobs.queues.map((queue) => (
                          <tr key={queue.name}>
                            <td className="px-4 py-2.5 font-medium">
                              {queue.label}
                              <span className="ml-2 text-xs font-normal text-muted-foreground">
                                {queue.name}
                              </span>
                              {queue.paused ? (
                                <span className="ml-2 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                                  paused
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 py-2.5 tabular-nums">
                              {queue.counts.active}
                            </td>
                            <td className="px-3 py-2.5 tabular-nums">
                              {queue.counts.waiting}
                            </td>
                            <td className="px-3 py-2.5 tabular-nums">
                              {queue.counts.delayed}
                            </td>
                            <td className="px-3 py-2.5 tabular-nums">
                              {queue.counts.failed}
                            </td>
                            <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                              {queue.counts.completed}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        {
                          id: "active",
                          label: `Active (${jobs.active.length})`,
                        },
                        {
                          id: "waiting",
                          label: `Queued (${jobs.waiting.length})`,
                        },
                        {
                          id: "delayed",
                          label: `Delayed (${jobs.delayed.length})`,
                        },
                        {
                          id: "failed",
                          label: `Failed (${jobs.failed.length})`,
                        },
                        {
                          id: "completed",
                          label: `Completed (${jobs.completed.length})`,
                        },
                      ] as const
                    ).map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => {
                          jobSectionTouched.current = true;
                          setJobSection(entry.id);
                        }}
                        className={cn(
                          "h-8 rounded-full px-3 text-xs font-medium",
                          jobSection === entry.id
                            ? "bg-primary/15 text-primary"
                            : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>

                  {jobList.length === 0 ? (
                    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
                      <Activity className="size-7 text-muted-foreground/70" />
                      <p className="text-sm text-muted-foreground">
                        No {jobSection} jobs right now
                      </p>
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {jobList.map((job) => (
                        <li
                          key={`${job.queue}:${job.id}`}
                          className="rounded-xl border border-border bg-card px-4 py-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={cn(
                                    "rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                                    stateTone(job.state),
                                  )}
                                >
                                  {job.state}
                                </span>
                                <p className="text-sm font-semibold">
                                  {job.queueLabel}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  #{job.id}
                                </p>
                              </div>
                              <p className="mt-1 text-sm">
                                {job.assetName ??
                                  (job.assetId
                                    ? `Asset ${job.assetId.slice(0, 8)}…`
                                    : job.name)}
                              </p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                Attempts {job.attemptsMade}
                                {" · "}
                                Queued {formatWhen(job.timestamp)}
                                {job.processedOn
                                  ? ` · Started ${formatWhen(job.processedOn)}`
                                  : ""}
                              </p>
                              {job.failedReason ? (
                                <p className="mt-1 text-xs text-destructive">
                                  {job.failedReason}
                                </p>
                              ) : null}
                            </div>
                            {job.assetId ? (
                              <Link
                                href={`/assets/${job.assetId}`}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-muted"
                              >
                                <ExternalLink className="size-3.5" />
                                Open asset
                              </Link>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
