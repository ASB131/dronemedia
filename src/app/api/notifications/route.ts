import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { recoverUnprocessedAssets } from "@/lib/jobs/recover-unprocessed";
import {
  listUserPipelineJobs,
  pipelineJobsToNotifications,
} from "@/lib/jobs/user-pipeline-jobs";
import {
  clearNotificationHistory,
  listNotificationsSince,
} from "@/lib/notifications/store";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  since: z.string().optional(),
  queueOnly: z
    .enum(["0", "1", "true", "false"])
    .optional()
    .transform((value) => value === "1" || value === "true"),
});

export async function GET(request: Request) {
  try {
    const session = await requireApprovedSession();
    const { searchParams } = new URL(request.url);
    const query = querySchema.parse({
      since: searchParams.get("since") ?? undefined,
      queueOnly: searchParams.get("queueOnly") ?? undefined,
    });

    const redis = getRedis();
    if (redis.status !== "ready") {
      await redis.connect();
    }

    // Kick recovery in parallel with reads (lock prevents stampede).
    const recoveryPromise = recoverUnprocessedAssets(session.user.id).catch(
      (error) => {
        console.error("[notifications] recoverUnprocessedAssets failed", error);
        return 0;
      },
    );

    if (query.queueOnly) {
      const recovered = await recoveryPromise;
      const jobs = await listUserPipelineJobs(session.user.id);
      return NextResponse.json({
        notifications: [],
        queueNotifications: pipelineJobsToNotifications(
          session.user.id,
          jobs,
        ),
        queueCounts: {
          active: jobs.filter((job) => job.state === "active").length,
          waiting: jobs.filter(
            (job) => job.state === "waiting" || job.state === "delayed",
          ).length,
        },
        recovered,
      });
    }

    const [notifications, pipelineJobs] = await Promise.all([
      listNotificationsSince(redis, session.user.id, query.since),
      listUserPipelineJobs(session.user.id),
    ]);

    const recovered = await recoveryPromise;
    // After recovery, refresh queue so newly enqueued jobs appear immediately.
    const jobs =
      recovered > 0
        ? await listUserPipelineJobs(session.user.id)
        : pipelineJobs;

    const queueNotifications = pipelineJobsToNotifications(
      session.user.id,
      jobs,
    );

    return NextResponse.json({
      notifications,
      queueNotifications,
      queueCounts: {
        active: jobs.filter((job) => job.state === "active").length,
        waiting: jobs.filter(
          (job) => job.state === "waiting" || job.state === "delayed",
        ).length,
      },
      recovered,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE() {
  try {
    const session = await requireApprovedSession();
    const redis = getRedis();
    if (redis.status !== "ready") {
      await redis.connect();
    }
    await clearNotificationHistory(redis, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
