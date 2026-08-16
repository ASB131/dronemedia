import { videoHlsPrefix } from "@/lib/assets/hls";
import { setAssetPlaybackFlags } from "@/lib/assets/playback-flags";
import { loadConfig } from "@/lib/config";
import { publishJobEvent } from "@/lib/jobs/enqueue";
import { isJobGateEnabled } from "@/lib/jobs/gates";
import { getWebTranscodingQueue } from "@/lib/jobs/queues";
import { JOB_NAMES } from "@/lib/jobs/types";
import { getStorageAdapter } from "@/lib/storage";

/** Wipe HLS cache for one asset and queue a fresh encode with current heights. */
export async function regenerateAssetHlsPreview(params: {
  userId: string;
  assetId: string;
  assetName?: string;
}): Promise<{ queued: boolean; reason?: string }> {
  const storage = getStorageAdapter();
  await storage.deletePrefix(videoHlsPrefix(params.userId, params.assetId), {
    tier: "cache",
  });
  await setAssetPlaybackFlags(params.assetId, { hasHls: false });

  if (!isJobGateEnabled(JOB_NAMES.WEB_TRANSCODING, true)) {
    return {
      queued: false,
      reason: "Transcoding is paused by an administrator",
    };
  }

  const config = loadConfig();
  const heights = config.transcoding.hls.heights ?? [];
  if (heights.length === 0) {
    return {
      queued: false,
      reason: "All streaming preview qualities are disabled",
    };
  }

  await getWebTranscodingQueue().add(
    "webTranscoding",
    { userId: params.userId, assetId: params.assetId },
    {
      jobId: `generate-hls-${params.assetId}-${Date.now()}`,
      attempts: config.jobs.retry.attempts,
      backoff: {
        type: "exponential",
        delay: config.jobs.retry.backoffMs,
      },
    },
  );
  await publishJobEvent({
    userId: params.userId,
    jobType: JOB_NAMES.WEB_TRANSCODING,
    assetId: params.assetId,
    assetName: params.assetName,
    status: "queued",
    timestamp: new Date().toISOString(),
  });
  return { queued: true };
}
