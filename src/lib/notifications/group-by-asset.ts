import type { StoredNotification } from "@/lib/notifications/store";

export const PIPELINE_JOB_TYPES = [
  "dedup",
  "thumbnails",
  "metadata",
  "srtFlightPath",
  "webTranscoding",
  "panoramaStitch",
] as const;

export type PipelineJobType = (typeof PIPELINE_JOB_TYPES)[number];

export type StepStatus =
  | "queued"
  | "processing"
  | "complete"
  | "failed"
  | "pending"
  | "skipped";

export type AssetJobGroup = {
  assetId: string;
  assetName: string;
  steps: Array<{
    jobType: PipelineJobType;
    status: StepStatus;
    message?: string;
    timestamp: string;
  }>;
  overall: "processing" | "complete" | "failed";
  latestTimestamp: string;
  /** True while any expected step is not terminal. */
  active: boolean;
};

const CORE_TYPES = ["dedup", "thumbnails", "metadata"] as const;
const OPTIONAL_TYPES = [
  "srtFlightPath",
  "webTranscoding",
  "panoramaStitch",
] as const;

function isPipelineJob(jobType: string): jobType is PipelineJobType {
  return (PIPELINE_JOB_TYPES as readonly string[]).includes(jobType);
}

function isTerminal(status: StepStatus): boolean {
  return (
    status === "complete" || status === "failed" || status === "skipped"
  );
}

function markCompleteIfNeeded(
  latestByType: Map<
    PipelineJobType,
    { status: StepStatus; message?: string; timestamp: string }
  >,
  jobType: PipelineJobType,
  timestamp: string,
) {
  const row = latestByType.get(jobType);
  if (!row) {
    latestByType.set(jobType, { status: "complete", timestamp });
    return;
  }
  if (row.status === "failed" || isTerminal(row.status)) return;
  latestByType.set(jobType, { ...row, status: "complete" });
}

/**
 * If a later step has started, earlier steps must already be done.
 * Covers missing/out-of-order "complete" events in the notification stream.
 */
function inferUpstreamComplete(
  latestByType: Map<
    PipelineJobType,
    { status: StepStatus; message?: string; timestamp: string }
  >,
  fallbackTimestamp: string,
) {
  const has = (type: PipelineJobType) => latestByType.has(type);
  if (
    has("thumbnails") ||
    has("metadata") ||
    has("srtFlightPath") ||
    has("webTranscoding") ||
    has("panoramaStitch")
  ) {
    markCompleteIfNeeded(latestByType, "dedup", fallbackTimestamp);
  }
  if (
    has("metadata") ||
    has("srtFlightPath") ||
    has("webTranscoding") ||
    has("panoramaStitch")
  ) {
    markCompleteIfNeeded(latestByType, "thumbnails", fallbackTimestamp);
  }
  if (
    has("srtFlightPath") ||
    has("webTranscoding") ||
    has("panoramaStitch")
  ) {
    markCompleteIfNeeded(latestByType, "metadata", fallbackTimestamp);
  }
}

/** Lifecycle order — never treat in-progress as "ahead of" done. */
function lifecycleRank(status: StepStatus): number {
  switch (status) {
    case "failed":
      return 5;
    case "complete":
    case "skipped":
      return 4;
    case "processing":
      return 3;
    case "queued":
      return 2;
    default:
      return 1;
  }
}

/**
 * Pick the effective status for a job type.
 * Newer events win, but a terminal status is never overwritten by an older
 * (or same-second) queued/processing event — that caused steps to stick on
 * "Running" forever after jobs finished.
 */
function pickStepStatus(
  prev: { status: StepStatus; message?: string; timestamp: string } | undefined,
  incoming: { status: StepStatus; message?: string; timestamp: string },
): { status: StepStatus; message?: string; timestamp: string } {
  if (!prev) return incoming;

  const prevTs = Date.parse(prev.timestamp);
  const nextTs = Date.parse(incoming.timestamp);
  const prevTerminal = isTerminal(prev.status);
  const nextTerminal = isTerminal(incoming.status);

  // Never regress from done/failed back to queued/running.
  if (prevTerminal && !nextTerminal) {
    return {
      ...prev,
      message: prev.message ?? incoming.message,
    };
  }

  if (nextTs > prevTs) {
    return {
      status: incoming.status,
      message: incoming.message ?? prev.message,
      timestamp: incoming.timestamp,
    };
  }

  if (nextTs < prevTs) {
    // Older event: only adopt if it is terminal and current is not
    // (out-of-order complete/failed after we already saw processing).
    if (nextTerminal && !prevTerminal) {
      return {
        status: incoming.status,
        message: incoming.message ?? prev.message,
        timestamp: incoming.timestamp,
      };
    }
    return {
      ...prev,
      message: prev.message ?? incoming.message,
    };
  }

  // Same timestamp: prefer further-along lifecycle status.
  if (lifecycleRank(incoming.status) >= lifecycleRank(prev.status)) {
    return {
      status: incoming.status,
      message: incoming.message ?? prev.message,
      timestamp: incoming.timestamp,
    };
  }
  return {
    ...prev,
    message: prev.message ?? incoming.message,
  };
}

export function groupNotificationsByAsset(items: StoredNotification[]): {
  groups: AssetJobGroup[];
  others: StoredNotification[];
} {
  const byAsset = new Map<
    string,
    {
      assetName: string;
      latestByType: Map<
        PipelineJobType,
        { status: StepStatus; message?: string; timestamp: string }
      >;
      latestTimestamp: string;
    }
  >();
  const others: StoredNotification[] = [];

  for (const item of items) {
    if (!item.assetId || !isPipelineJob(item.jobType)) {
      others.push(item);
      continue;
    }

    let group = byAsset.get(item.assetId);
    if (!group) {
      group = {
        assetName: item.assetName || "Uploading file",
        latestByType: new Map(),
        latestTimestamp: item.timestamp,
      };
      byAsset.set(item.assetId, group);
    }
    if (item.assetName) group.assetName = item.assetName;
    if (Date.parse(item.timestamp) > Date.parse(group.latestTimestamp)) {
      group.latestTimestamp = item.timestamp;
    }

    group.latestByType.set(
      item.jobType,
      pickStepStatus(group.latestByType.get(item.jobType), {
        status: item.status,
        message: item.message,
        timestamp: item.timestamp,
      }),
    );
  }

  const groups: AssetJobGroup[] = [];
  for (const [assetId, group] of byAsset) {
    // Later pipeline activity implies earlier steps finished, even if a
    // "complete" event was dropped or corrupted by out-of-order merges.
    inferUpstreamComplete(group.latestByType, group.latestTimestamp);

    const metadata = group.latestByType.get("metadata");
    const metadataDone =
      metadata?.status === "complete" || metadata?.status === "failed";

    const steps: AssetJobGroup["steps"] = [];

    for (const jobType of CORE_TYPES) {
      const row = group.latestByType.get(jobType);
      steps.push({
        jobType,
        status: row?.status ?? "pending",
        message: row?.message,
        timestamp: row?.timestamp ?? group.latestTimestamp,
      });
    }

    for (const jobType of OPTIONAL_TYPES) {
      const row = group.latestByType.get(jobType);
      // Only show optional steps that were actually queued for this asset
      // (videos get transcoding; panoramas get stitch; photos get neither).
      if (!row) continue;
      steps.push({
        jobType,
        status: row.status,
        message: row.message,
        timestamp: row.timestamp,
      });
    }

    const hasFailed = steps.some((step) => step.status === "failed");
    const hasActive = steps.some(
      (step) =>
        step.status === "queued" ||
        step.status === "processing" ||
        step.status === "pending",
    );
    const coreDone = CORE_TYPES.every((type) => {
      const row = group.latestByType.get(type);
      return row != null && isTerminal(row.status);
    });
    const optionalDone = OPTIONAL_TYPES.every((type) => {
      const row = group.latestByType.get(type);
      if (!row) {
        // Not queued: done once metadata is terminal (skipped or never needed).
        return metadataDone;
      }
      return isTerminal(row.status);
    });

    const active = hasActive || !coreDone || !optionalDone;
    const overall: AssetJobGroup["overall"] = hasFailed
      ? "failed"
      : active
        ? "processing"
        : "complete";

    groups.push({
      assetId,
      assetName: group.assetName,
      steps,
      overall,
      latestTimestamp: group.latestTimestamp,
      active,
    });
  }

  groups.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return Date.parse(b.latestTimestamp) - Date.parse(a.latestTimestamp);
  });

  return { groups, others };
}

/** Keep events for still-active assets; drop finished pipeline noise. */
export function pruneFinishedNotifications(
  items: StoredNotification[],
): StoredNotification[] {
  const { groups } = groupNotificationsByAsset(items);
  const activeIds = new Set(
    groups.filter((group) => group.active).map((group) => group.assetId),
  );

  return items.filter((item) => {
    if (!item.assetId || !isPipelineJob(item.jobType)) {
      // Keep non-pipeline items that are not complete (e.g. service reminders).
      return item.status === "queued" || item.status === "processing";
    }
    return activeIds.has(item.assetId);
  });
}
