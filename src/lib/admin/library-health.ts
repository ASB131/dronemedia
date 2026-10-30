import { and, eq, isNull, sql } from "drizzle-orm";

import { getWebDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { listUnresolvedJobFailures } from "@/lib/assets/exports";
import { getJobsStatusGlobal } from "@/lib/jobs/status";
import { JOB_NAMES } from "@/lib/jobs/types";
import { USER_PIPELINE_QUEUES } from "@/lib/jobs/user-pipeline-jobs";

const STUCK_ACTIVE_MS = 20 * 60 * 1000;

export type LibraryHealthSummary = {
  pipelineBacklog: number;
  stuckActiveJobs: number;
  failedJobs: number;
  missingHlsVideos: number;
  thumbnailIssues: number;
  fetchedAt: string;
};

export async function getLibraryHealthSummary(): Promise<LibraryHealthSummary> {
  const db = getWebDb();
  const [status, failures] = await Promise.all([
    getJobsStatusGlobal(),
    listUnresolvedJobFailures(200),
  ]);

  const pipelineNames = new Set<string>(USER_PIPELINE_QUEUES);
  let pipelineBacklog = 0;
  for (const queue of status.queues) {
    if (!pipelineNames.has(queue.name)) continue;
    pipelineBacklog += queue.counts.waiting + queue.counts.delayed;
  }

  const now = Date.now();
  const stuckActiveJobs = status.active.filter((job) => {
    if (!job.processedOn) return false;
    const started = new Date(job.processedOn).getTime();
    return now - started > STUCK_ACTIVE_MS;
  }).length;

  const thumbnailIssues =
    failures.filter((row) => row.jobType === JOB_NAMES.THUMBNAILS).length +
    (status.queues.find((q) => q.name === JOB_NAMES.THUMBNAILS)?.counts
      .failed ?? 0);

  const [missingHlsRow] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(assets)
    .where(
      and(
        isNull(assets.deletedAt),
        eq(assets.assetType, "video"),
        eq(assets.hasHls, false),
      ),
    );

  const failedJobs = status.totals.failed;

  return {
    pipelineBacklog,
    stuckActiveJobs,
    failedJobs,
    missingHlsVideos: missingHlsRow?.count ?? 0,
    thumbnailIssues,
    fetchedAt: new Date().toISOString(),
  };
}
