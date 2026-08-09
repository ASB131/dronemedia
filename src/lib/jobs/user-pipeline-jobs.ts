import { inArray } from "drizzle-orm";
import type { Job, JobType } from "bullmq";

import { getWebDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import type { StoredNotification } from "@/lib/notifications/store";
import { getQueueByName } from "./queues";
import { JOB_NAMES, type JobName } from "./types";

/** Queues that process user media (exclude maintenance). */
export const USER_PIPELINE_QUEUES = [
  JOB_NAMES.DEDUP,
  JOB_NAMES.THUMBNAILS,
  JOB_NAMES.METADATA,
  JOB_NAMES.SRT_FLIGHT_PATH,
  JOB_NAMES.WEB_TRANSCODING,
  JOB_NAMES.PANORAMA_STITCH,
  JOB_NAMES.SEQUENCE_EXPORT,
] as const satisfies readonly JobName[];

export type UserPipelineJob = {
  assetId: string;
  assetName: string | null;
  jobType: JobName;
  state: "active" | "waiting" | "delayed";
  timestamp: string;
};

type JobData = {
  userId?: string;
  assetId?: string;
};

async function collectQueueJobs(
  queueName: JobName,
  types: JobType[],
  userId: string,
  limit: number,
) {
  const queue = getQueueByName(queueName);
  const jobs = await queue.getJobs(types, 0, limit);
  return jobs.filter((job): job is Job => {
    if (!job) return false;
    const data = (job.data ?? {}) as JobData;
    return data.userId === userId && typeof data.assetId === "string";
  });
}

/** Live BullMQ waiting/active/delayed jobs for this user's media pipeline. */
export async function listUserPipelineJobs(
  userId: string,
): Promise<UserPipelineJob[]> {
  const results = await Promise.all(
    USER_PIPELINE_QUEUES.map(async (queueName) => {
      const [active, waiting, delayed] = await Promise.all([
        collectQueueJobs(queueName, ["active"], userId, 100),
        collectQueueJobs(
          queueName,
          ["waiting", "wait", "prioritized"],
          userId,
          200,
        ),
        collectQueueJobs(queueName, ["delayed"], userId, 100),
      ]);
      return { queueName, active, waiting, delayed };
    }),
  );

  const assetIds = new Set<string>();
  for (const row of results) {
    for (const job of [...row.active, ...row.waiting, ...row.delayed]) {
      const data = (job.data ?? {}) as JobData;
      if (typeof data.assetId === "string") assetIds.add(data.assetId);
    }
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

  const out: UserPipelineJob[] = [];
  for (const row of results) {
    const push = (job: Job, state: UserPipelineJob["state"]) => {
      const data = (job.data ?? {}) as JobData;
      const assetId = data.assetId!;
      out.push({
        assetId,
        assetName: assetNames.get(assetId) ?? null,
        jobType: row.queueName,
        state,
        timestamp: new Date(
          job.processedOn ?? job.timestamp ?? Date.now(),
        ).toISOString(),
      });
    };
    for (const job of row.active) push(job, "active");
    for (const job of row.waiting) push(job, "waiting");
    for (const job of row.delayed) push(job, "delayed");
  }

  // Prefer active over waiting for the same asset+jobType.
  out.sort((a, b) => {
    const rank = (state: UserPipelineJob["state"]) =>
      state === "active" ? 0 : state === "delayed" ? 1 : 2;
    if (rank(a.state) !== rank(b.state)) return rank(a.state) - rank(b.state);
    return Date.parse(b.timestamp) - Date.parse(a.timestamp);
  });

  return out;
}

export function pipelineJobsToNotifications(
  userId: string,
  jobs: UserPipelineJob[],
): StoredNotification[] {
  const seen = new Set<string>();
  const notifications: StoredNotification[] = [];

  for (const job of jobs) {
    const key = `${job.assetId}:${job.jobType}`;
    if (seen.has(key)) continue;
    seen.add(key);

    notifications.push({
      userId,
      jobType: job.jobType,
      assetId: job.assetId,
      assetName: job.assetName ?? undefined,
      status: job.state === "active" ? "processing" : "queued",
      timestamp: job.timestamp,
    });
  }

  return notifications;
}

/** Asset ids that currently have a live pipeline job. */
export async function listQueuedAssetIds(userId: string): Promise<Set<string>> {
  const jobs = await listUserPipelineJobs(userId);
  return new Set(jobs.map((job) => job.assetId));
}
