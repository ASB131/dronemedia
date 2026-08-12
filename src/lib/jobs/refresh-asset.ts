import { loadConfig } from "@/lib/config";
import { isJobGateEnabled } from "@/lib/jobs/gates";
import {
  getMetadataQueue,
  getPanoramaStitchQueue,
  getThumbnailsQueue,
  getWebTranscodingQueue,
} from "@/lib/jobs/queues";
import { JOB_NAMES, type JobName } from "@/lib/jobs/types";
import { enqueueAssetPipeline, publishJobEvent } from "@/lib/jobs/enqueue";

export type AssetRefreshOptions = {
  thumbnails?: boolean;
  metadata?: boolean;
  dedup?: boolean;
  /** Optional: requeue web/HLS (and sequence export path via metadata chain). */
  webTranscoding?: boolean;
  panoramaStitch?: boolean;
};

async function enqueueNamed(
  queueName: JobName,
  userId: string,
  assetId: string,
  assetName?: string,
) {
  const config = loadConfig();
  const retry = {
    attempts: config.jobs.retry.attempts,
    backoff: {
      type: "exponential" as const,
      delay: config.jobs.retry.backoffMs,
    },
  };

  if (queueName === JOB_NAMES.THUMBNAILS) {
    await getThumbnailsQueue().add(
      "thumbnails",
      { userId, assetId },
      { ...retry, jobId: `refresh-thumbnails-${assetId}-${Date.now()}` },
    );
  } else if (queueName === JOB_NAMES.METADATA) {
    await getMetadataQueue().add(
      "metadata",
      { userId, assetId },
      { ...retry, jobId: `refresh-metadata-${assetId}-${Date.now()}` },
    );
  } else if (queueName === JOB_NAMES.WEB_TRANSCODING) {
    if (!isJobGateEnabled(JOB_NAMES.WEB_TRANSCODING, true)) return false;
    await getWebTranscodingQueue().add(
      "webTranscoding",
      { userId, assetId },
      { ...retry, jobId: `refresh-web-${assetId}-${Date.now()}` },
    );
  } else if (queueName === JOB_NAMES.PANORAMA_STITCH) {
    if (!isJobGateEnabled(JOB_NAMES.PANORAMA_STITCH, true)) return false;
    await getPanoramaStitchQueue().add(
      "panoramaStitch",
      { userId, assetId },
      { ...retry, jobId: `refresh-pano-${assetId}-${Date.now()}` },
    );
  } else {
    return false;
  }

  await publishJobEvent({
    userId,
    jobType: queueName,
    assetId,
    assetName,
    status: "queued",
    timestamp: new Date().toISOString(),
  });
  return true;
}

/**
 * Re-enqueue processing for an existing asset (does not re-upload originals).
 * Defaults: thumbnails + metadata + dedup.
 */
export async function enqueueAssetRefresh(params: {
  userId: string;
  assetId: string;
  assetName?: string;
  options?: AssetRefreshOptions;
}): Promise<{ queued: JobName[] }> {
  const opts = params.options ?? {};
  const queued: JobName[] = [];

  const wantThumbnails = opts.thumbnails !== false;
  const wantMetadata = opts.metadata !== false;
  const wantDedup = opts.dedup !== false;
  const wantWeb = Boolean(opts.webTranscoding);
  const wantPano = Boolean(opts.panoramaStitch);

  if (wantDedup) {
    await enqueueAssetPipeline({
      userId: params.userId,
      assetId: params.assetId,
      onDuplicate: "flag",
      assetName: params.assetName,
    });
    queued.push(JOB_NAMES.DEDUP);
    // Pipeline already chains thumbnails → metadata; skip separate enqueue
    // unless only thumbnails/metadata were requested without dedup.
    if (!wantWeb && !wantPano) {
      return { queued };
    }
  }

  if (wantThumbnails && !wantDedup) {
    if (await enqueueNamed(JOB_NAMES.THUMBNAILS, params.userId, params.assetId, params.assetName)) {
      queued.push(JOB_NAMES.THUMBNAILS);
    }
  }

  if (wantMetadata && !wantDedup) {
    if (await enqueueNamed(JOB_NAMES.METADATA, params.userId, params.assetId, params.assetName)) {
      queued.push(JOB_NAMES.METADATA);
    }
  }

  if (wantWeb) {
    if (
      await enqueueNamed(
        JOB_NAMES.WEB_TRANSCODING,
        params.userId,
        params.assetId,
        params.assetName,
      )
    ) {
      queued.push(JOB_NAMES.WEB_TRANSCODING);
    }
  }

  if (wantPano) {
    if (
      await enqueueNamed(
        JOB_NAMES.PANORAMA_STITCH,
        params.userId,
        params.assetId,
        params.assetName,
      )
    ) {
      queued.push(JOB_NAMES.PANORAMA_STITCH);
    }
  }

  return { queued };
}
