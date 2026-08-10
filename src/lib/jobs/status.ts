import { inArray } from "drizzle-orm";
import type { Job, JobType } from "bullmq";

import { getWebDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { ALL_QUEUE_NAMES, getQueueByName } from "./queues";
import { JOB_NAMES, type JobName } from "./types";

export const QUEUE_LABELS: Record<JobName, string> = {
  [JOB_NAMES.DEDUP]: "Dedup",
  [JOB_NAMES.THUMBNAILS]: "Thumbnails",
  [JOB_NAMES.METADATA]: "Metadata",
  [JOB_NAMES.SRT_FLIGHT_PATH]: "Flight path",
  [JOB_NAMES.WEB_TRANSCODING]: "Transcoding",
  [JOB_NAMES.PANORAMA_STITCH]: "Panorama stitch",
  [JOB_NAMES.SEQUENCE_EXPORT]: "Sequence export",
  [JOB_NAMES.BIN_CLEANUP]: "Bin cleanup",
  [JOB_NAMES.ORPHAN_UPLOAD_CLEANUP]: "Orphan uploads",
  [JOB_NAMES.INTEGRITY_CHECK]: "Integrity check",
  [JOB_NAMES.DATABASE_BACKUP]: "Database backup",
};

export type QueueCountsDto = {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
};

export type QueueSummaryDto = {
  name: JobName;
  label: string;
  paused: boolean;
  counts: QueueCountsDto;
};

export type JobListItemDto = {
  id: string;
  queue: JobName;
  queueLabel: string;
  state: "active" | "waiting" | "delayed" | "failed" | "completed";
  name: string;
  assetId: string | null;
  assetName: string | null;
  userId: string | null;
  attemptsMade: number;
  timestamp: string | null;
  processedOn: string | null;
  finishedOn: string | null;
  failedReason: string | null;
  progress: number | string | object | null;
};

export type JobsStatusDto = {
  totals: QueueCountsDto;
  queues: QueueSummaryDto[];
  active: JobListItemDto[];
  waiting: JobListItemDto[];
  delayed: JobListItemDto[];
  failed: JobListItemDto[];
  completed: JobListItemDto[];
  fetchedAt: string;
};

type JobData = {
  userId?: string;
  assetId?: string;
};

function emptyCounts(): QueueCountsDto {
  return {
    waiting: 0,
    active: 0,
    delayed: 0,
    completed: 0,
    failed: 0,
  };
}

function addCounts(a: QueueCountsDto, b: QueueCountsDto): QueueCountsDto {
  return {
    waiting: a.waiting + b.waiting,
    active: a.active + b.active,
    delayed: a.delayed + b.delayed,
    completed: a.completed + b.completed,
    failed: a.failed + b.failed,
  };
}

function readCount(
  raw: Record<string, number>,
  ...keys: string[]
): number {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "number") return value;
  }
  return 0;
}

async function mapJob(
  queueName: JobName,
  job: Job,
  state: JobListItemDto["state"],
  assetNames: Map<string, string>,
): Promise<JobListItemDto> {
  const data = (job.data ?? {}) as JobData;
  const assetId = typeof data.assetId === "string" ? data.assetId : null;
  return {
    id: String(job.id),
    queue: queueName,
    queueLabel: QUEUE_LABELS[queueName],
    state,
    name: job.name,
    assetId,
    assetName: assetId ? (assetNames.get(assetId) ?? null) : null,
    userId: typeof data.userId === "string" ? data.userId : null,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp ? new Date(job.timestamp).toISOString() : null,
    processedOn: job.processedOn
      ? new Date(job.processedOn).toISOString()
      : null,
    finishedOn: job.finishedOn
      ? new Date(job.finishedOn).toISOString()
      : null,
    failedReason: job.failedReason ?? null,
    progress:
      typeof job.progress === "number" ||
      typeof job.progress === "string" ||
      (job.progress && typeof job.progress === "object")
        ? job.progress
        : null,
  };
}

function belongsToUser(job: Job, userId: string) {
  const data = (job.data ?? {}) as JobData;
  // Maintenance jobs have no userId — include them for everyone.
  if (!data.userId) return true;
  return data.userId === userId;
}

async function collectJobs(
  queueName: JobName,
  types: JobType[],
  userId: string | null,
  limit: number,
) {
  const queue = getQueueByName(queueName);
  const jobs = await queue.getJobs(types, 0, limit);
  return jobs
    .filter((job): job is Job => {
      if (!job) return false;
      if (userId == null) return true;
      return belongsToUser(job, userId);
    })
    .map((job) => ({ queue: queueName, job }));
}

async function buildJobsStatus(
  userId: string | null,
  limits: {
    active: number;
    waiting: number;
    delayed: number;
    failed: number;
    completed: number;
  },
): Promise<JobsStatusDto> {
  const queues: QueueSummaryDto[] = [];
  let totals = emptyCounts();

  const countResults = await Promise.all(
    ALL_QUEUE_NAMES.map(async (name) => {
      const queue = getQueueByName(name);
      const [raw, paused] = await Promise.all([
        queue.getJobCounts(
          "waiting",
          "active",
          "delayed",
          "completed",
          "failed",
          "prioritized",
        ),
        queue.isPaused(),
      ]);
      const counts: QueueCountsDto = {
        waiting:
          readCount(raw, "waiting", "wait") + readCount(raw, "prioritized"),
        active: readCount(raw, "active"),
        delayed: readCount(raw, "delayed"),
        completed: readCount(raw, "completed"),
        failed: readCount(raw, "failed"),
      };
      return { name, paused, counts };
    }),
  );

  for (const row of countResults) {
    queues.push({
      name: row.name,
      label: QUEUE_LABELS[row.name],
      paused: row.paused,
      counts: row.counts,
    });
    totals = addCounts(totals, row.counts);
  }

  const listResults = await Promise.all(
    ALL_QUEUE_NAMES.map(async (name) => {
      const [active, waiting, delayed, failed, completed] = await Promise.all([
        collectJobs(name, ["active"], userId, limits.active),
        collectJobs(
          name,
          ["waiting", "wait", "prioritized"],
          userId,
          limits.waiting,
        ),
        collectJobs(name, ["delayed"], userId, limits.delayed),
        collectJobs(name, ["failed"], userId, limits.failed),
        collectJobs(name, ["completed"], userId, limits.completed),
      ]);
      return { active, waiting, delayed, failed, completed };
    }),
  );

  const activeJobs = listResults.flatMap((row) => row.active);
  const waitingJobs = listResults.flatMap((row) => row.waiting);
  const delayedJobs = listResults.flatMap((row) => row.delayed);
  const failedJobs = listResults.flatMap((row) => row.failed);
  const completedJobs = listResults.flatMap((row) => row.completed);

  const assetIds = new Set<string>();
  for (const entry of [
    ...activeJobs,
    ...waitingJobs,
    ...delayedJobs,
    ...failedJobs,
    ...completedJobs,
  ]) {
    const data = (entry.job.data ?? {}) as JobData;
    if (typeof data.assetId === "string") assetIds.add(data.assetId);
  }

  const assetNames = new Map<string, string>();
  if (assetIds.size > 0) {
    const db = getWebDb();
    const rows = await db
      .select({ id: assets.id, displayName: assets.displayName })
      .from(assets)
      .where(inArray(assets.id, [...assetIds]));
    for (const row of rows) {
      assetNames.set(row.id, row.displayName);
    }
  }

  const sortNewest = (a: { job: Job }, b: { job: Job }) =>
    (b.job.finishedOn ?? b.job.processedOn ?? b.job.timestamp ?? 0) -
    (a.job.finishedOn ?? a.job.processedOn ?? a.job.timestamp ?? 0);

  activeJobs.sort(sortNewest);
  waitingJobs.sort(sortNewest);
  delayedJobs.sort(sortNewest);
  failedJobs.sort(sortNewest);
  completedJobs.sort(sortNewest);

  return {
    totals,
    queues,
    active: await Promise.all(
      activeJobs
        .slice(0, limits.active)
        .map(({ queue, job }) => mapJob(queue, job, "active", assetNames)),
    ),
    waiting: await Promise.all(
      waitingJobs
        .slice(0, limits.waiting)
        .map(({ queue, job }) => mapJob(queue, job, "waiting", assetNames)),
    ),
    delayed: await Promise.all(
      delayedJobs
        .slice(0, limits.delayed)
        .map(({ queue, job }) => mapJob(queue, job, "delayed", assetNames)),
    ),
    failed: await Promise.all(
      failedJobs
        .slice(0, limits.failed)
        .map(({ queue, job }) => mapJob(queue, job, "failed", assetNames)),
    ),
    completed: await Promise.all(
      completedJobs
        .slice(0, limits.completed)
        .map(({ queue, job }) => mapJob(queue, job, "completed", assetNames)),
    ),
    fetchedAt: new Date().toISOString(),
  };
}

export async function getJobsStatusForUser(
  userId: string,
): Promise<JobsStatusDto> {
  return buildJobsStatus(userId, {
    active: 80,
    waiting: 80,
    delayed: 50,
    failed: 50,
    completed: 80,
  });
}

/** Admin: all users, larger lists. */
export async function getJobsStatusGlobal(): Promise<JobsStatusDto> {
  return buildJobsStatus(null, {
    active: 150,
    waiting: 200,
    delayed: 100,
    failed: 100,
    completed: 100,
  });
}
