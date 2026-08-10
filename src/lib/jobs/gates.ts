import { and, eq, isNull, ne, or } from "drizzle-orm";

import { patchAdminSettings } from "@/lib/admin/settings";
import { loadConfig } from "@/lib/config";
import { getWebDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import {
  getPanoramaStitchQueue,
  getWebTranscodingQueue,
} from "@/lib/jobs/queues";
import { JOB_NAMES, type JobName } from "@/lib/jobs/types";

export type GatedJobName =
  | typeof JOB_NAMES.WEB_TRANSCODING
  | typeof JOB_NAMES.PANORAMA_STITCH;

export const GATED_JOB_NAMES: GatedJobName[] = [
  JOB_NAMES.WEB_TRANSCODING,
  JOB_NAMES.PANORAMA_STITCH,
];

export function isGatedJob(name: string): name is GatedJobName {
  return (GATED_JOB_NAMES as string[]).includes(name);
}

export function getJobGates(forceReload = false) {
  const config = loadConfig(forceReload);
  return {
    webTranscoding: config.jobs.gates?.webTranscoding ?? true,
    panoramaStitch: config.jobs.gates?.panoramaStitch ?? true,
  };
}

export function isJobGateEnabled(
  name: GatedJobName,
  forceReload = false,
): boolean {
  const gates = getJobGates(forceReload);
  if (name === JOB_NAMES.WEB_TRANSCODING) return gates.webTranscoding;
  if (name === JOB_NAMES.PANORAMA_STITCH) return gates.panoramaStitch;
  return true;
}

function queueForGate(name: GatedJobName) {
  if (name === JOB_NAMES.WEB_TRANSCODING) return getWebTranscodingQueue();
  return getPanoramaStitchQueue();
}

export async function setJobGate(
  name: GatedJobName,
  enabled: boolean,
): Promise<{ enabled: boolean; backfilled: number }> {
  const patch =
    name === JOB_NAMES.WEB_TRANSCODING
      ? { jobs: { gates: { webTranscoding: enabled } } }
      : { jobs: { gates: { panoramaStitch: enabled } } };

  patchAdminSettings(patch);
  loadConfig(true);

  const queue = queueForGate(name);
  if (enabled) {
    await queue.resume();
    const backfilled = await backfillJobGate(name);
    return { enabled: true, backfilled };
  }

  await queue.pause();
  return { enabled: false, backfilled: 0 };
}

const BACKFILL_BATCH = 100;

export async function backfillJobGate(name: GatedJobName): Promise<number> {
  const config = loadConfig(true);
  const db = getWebDb();
  const jobOpts = {
    attempts: config.jobs.retry.attempts,
    backoff: {
      type: "exponential" as const,
      delay: config.jobs.retry.backoffMs,
    },
  };

  if (name === JOB_NAMES.WEB_TRANSCODING) {
    const rows = await db
      .select({ id: assets.id, userId: assets.userId })
      .from(assets)
      .where(
        and(
          isNull(assets.deletedAt),
          or(
            eq(assets.assetType, "video"),
            and(
              eq(assets.assetType, "sequence"),
              ne(assets.sequenceKind, "panorama"),
            ),
          ),
          or(eq(assets.hasHls, false), eq(assets.hasProxy, false)),
        ),
      )
      .limit(5000);

    const queue = getWebTranscodingQueue();
    let queued = 0;
    for (let i = 0; i < rows.length; i += BACKFILL_BATCH) {
      const chunk = rows.slice(i, i + BACKFILL_BATCH);
      await Promise.all(
        chunk.map(async (row) => {
          const jobId = `webTranscoding-${row.id}`;
          const existing = await queue.getJob(jobId);
          if (existing) {
            const state = await existing.getState();
            if (state === "completed" || state === "failed") {
              await existing.remove().catch(() => undefined);
            } else {
              return;
            }
          }
          await queue.add(
            "webTranscoding",
            { userId: row.userId, assetId: row.id },
            {
              ...jobOpts,
              jobId,
            },
          );
          queued += 1;
        }),
      );
    }
    return queued;
  }

  // Panorama stitch: sequences still marked panorama without preview flag.
  // hasPanoPreview is derived at read time; use sequenceKind + type.
  const rows = await db
    .select({ id: assets.id, userId: assets.userId })
    .from(assets)
    .where(
      and(
        isNull(assets.deletedAt),
        eq(assets.assetType, "sequence"),
        eq(assets.sequenceKind, "panorama"),
      ),
    )
    .limit(2000);

  const queue = getPanoramaStitchQueue();
  let queued = 0;
  for (const row of rows) {
    await queue.add(
      "panoramaStitch",
      { userId: row.userId, assetId: row.id },
      {
        ...jobOpts,
        jobId: `panoramaStitch-${row.id}`,
      },
    );
    queued += 1;
  }
  return queued;
}

/** Assets waiting on a paused gate (for user Jobs UI). */
export async function listDeferredJobsForUser(userId: string) {
  const gates = getJobGates(true);
  const db = getWebDb();
  const deferred: Array<{
    assetId: string;
    assetName: string;
    job: GatedJobName;
    reason: string;
  }> = [];

  if (!gates.webTranscoding) {
    const rows = await db
      .select({
        id: assets.id,
        displayName: assets.displayName,
      })
      .from(assets)
      .where(
        and(
          eq(assets.userId, userId),
          isNull(assets.deletedAt),
          or(
            eq(assets.assetType, "video"),
            and(
              eq(assets.assetType, "sequence"),
              ne(assets.sequenceKind, "panorama"),
            ),
          ),
          or(eq(assets.hasHls, false), eq(assets.hasProxy, false)),
        ),
      )
      .limit(200);

    for (const row of rows) {
      deferred.push({
        assetId: row.id,
        assetName: row.displayName,
        job: JOB_NAMES.WEB_TRANSCODING,
        reason: "Waiting to transcode — paused by administrator",
      });
    }
  }

  if (!gates.panoramaStitch) {
    const rows = await db
      .select({
        id: assets.id,
        displayName: assets.displayName,
      })
      .from(assets)
      .where(
        and(
          eq(assets.userId, userId),
          isNull(assets.deletedAt),
          eq(assets.assetType, "sequence"),
          eq(assets.sequenceKind, "panorama"),
        ),
      )
      .limit(200);

    for (const row of rows) {
      deferred.push({
        assetId: row.id,
        assetName: row.displayName,
        job: JOB_NAMES.PANORAMA_STITCH,
        reason: "Waiting to stitch — paused by administrator",
      });
    }
  }

  return deferred;
}

export async function syncGateQueuePausedState() {
  const gates = getJobGates(true);
  const webQ = getWebTranscodingQueue();
  const panoQ = getPanoramaStitchQueue();
  if (gates.webTranscoding) await webQ.resume();
  else await webQ.pause();
  if (gates.panoramaStitch) await panoQ.resume();
  else await panoQ.pause();
}

export function gateLabel(name: GatedJobName): string {
  if (name === JOB_NAMES.WEB_TRANSCODING) return "Transcoding";
  return "Panorama stitch";
}

/** Type guard helper for enqueue sites. */
export function assertCanEnqueue(name: JobName): boolean {
  if (!isGatedJob(name)) return true;
  return isJobGateEnabled(name, true);
}
