import { Queue } from "bullmq";

import { getRedisUrl } from "@/lib/config";
import {
  JOB_NAMES,
  type DedupJobData,
  type AssetJobData,
  type JobName,
} from "./types";

function bullConnection() {
  return {
    url: getRedisUrl(),
    maxRetriesPerRequest: null as null,
  };
}

let dedupQueue: Queue<DedupJobData> | null = null;
let thumbnailsQueue: Queue<AssetJobData> | null = null;
let metadataQueue: Queue<AssetJobData> | null = null;
let srtFlightPathQueue: Queue<AssetJobData> | null = null;
let webTranscodingQueue: Queue<AssetJobData> | null = null;
let panoramaStitchQueue: Queue<AssetJobData> | null = null;
let sequenceExportQueue: Queue<AssetJobData> | null = null;
let integrityCheckQueue: Queue | null = null;
let binCleanupQueue: Queue | null = null;
let orphanUploadCleanupQueue: Queue | null = null;
let databaseBackupQueue: Queue | null = null;

export function getDedupQueue() {
  if (!dedupQueue) {
    dedupQueue = new Queue<DedupJobData>(JOB_NAMES.DEDUP, {
      connection: bullConnection(),
    });
  }
  return dedupQueue;
}

export function getThumbnailsQueue() {
  if (!thumbnailsQueue) {
    thumbnailsQueue = new Queue<AssetJobData>(JOB_NAMES.THUMBNAILS, {
      connection: bullConnection(),
    });
  }
  return thumbnailsQueue;
}

export function getMetadataQueue() {
  if (!metadataQueue) {
    metadataQueue = new Queue<AssetJobData>(JOB_NAMES.METADATA, {
      connection: bullConnection(),
    });
  }
  return metadataQueue;
}

export function getSrtFlightPathQueue() {
  if (!srtFlightPathQueue) {
    srtFlightPathQueue = new Queue<AssetJobData>(JOB_NAMES.SRT_FLIGHT_PATH, {
      connection: bullConnection(),
    });
  }
  return srtFlightPathQueue;
}

export function getWebTranscodingQueue() {
  if (!webTranscodingQueue) {
    webTranscodingQueue = new Queue<AssetJobData>(JOB_NAMES.WEB_TRANSCODING, {
      connection: bullConnection(),
    });
  }
  return webTranscodingQueue;
}

export function getPanoramaStitchQueue() {
  if (!panoramaStitchQueue) {
    panoramaStitchQueue = new Queue<AssetJobData>(JOB_NAMES.PANORAMA_STITCH, {
      connection: bullConnection(),
    });
  }
  return panoramaStitchQueue;
}

export function getSequenceExportQueue() {
  if (!sequenceExportQueue) {
    sequenceExportQueue = new Queue<AssetJobData>(JOB_NAMES.SEQUENCE_EXPORT, {
      connection: bullConnection(),
    });
  }
  return sequenceExportQueue;
}

export function getIntegrityCheckQueue() {
  if (!integrityCheckQueue) {
    integrityCheckQueue = new Queue(JOB_NAMES.INTEGRITY_CHECK, {
      connection: bullConnection(),
    });
  }
  return integrityCheckQueue;
}

export function getBinCleanupQueue() {
  if (!binCleanupQueue) {
    binCleanupQueue = new Queue(JOB_NAMES.BIN_CLEANUP, {
      connection: bullConnection(),
    });
  }
  return binCleanupQueue;
}

export function getOrphanUploadCleanupQueue() {
  if (!orphanUploadCleanupQueue) {
    orphanUploadCleanupQueue = new Queue(JOB_NAMES.ORPHAN_UPLOAD_CLEANUP, {
      connection: bullConnection(),
    });
  }
  return orphanUploadCleanupQueue;
}

export function getDatabaseBackupQueue() {
  if (!databaseBackupQueue) {
    databaseBackupQueue = new Queue(JOB_NAMES.DATABASE_BACKUP, {
      connection: bullConnection(),
    });
  }
  return databaseBackupQueue;
}

export function getQueueByName(name: JobName): Queue {
  switch (name) {
    case JOB_NAMES.DEDUP:
      return getDedupQueue();
    case JOB_NAMES.THUMBNAILS:
      return getThumbnailsQueue();
    case JOB_NAMES.METADATA:
      return getMetadataQueue();
    case JOB_NAMES.SRT_FLIGHT_PATH:
      return getSrtFlightPathQueue();
    case JOB_NAMES.WEB_TRANSCODING:
      return getWebTranscodingQueue();
    case JOB_NAMES.PANORAMA_STITCH:
      return getPanoramaStitchQueue();
    case JOB_NAMES.SEQUENCE_EXPORT:
      return getSequenceExportQueue();
    case JOB_NAMES.INTEGRITY_CHECK:
      return getIntegrityCheckQueue();
    case JOB_NAMES.BIN_CLEANUP:
      return getBinCleanupQueue();
    case JOB_NAMES.ORPHAN_UPLOAD_CLEANUP:
      return getOrphanUploadCleanupQueue();
    case JOB_NAMES.DATABASE_BACKUP:
      return getDatabaseBackupQueue();
    default: {
      const exhaustive: never = name;
      throw new Error(`Unknown queue: ${exhaustive}`);
    }
  }
}

export const ALL_QUEUE_NAMES = Object.values(JOB_NAMES);

export async function closeQueues() {
  await Promise.all([
    dedupQueue?.close(),
    thumbnailsQueue?.close(),
    metadataQueue?.close(),
    srtFlightPathQueue?.close(),
    webTranscodingQueue?.close(),
    panoramaStitchQueue?.close(),
    sequenceExportQueue?.close(),
    integrityCheckQueue?.close(),
    binCleanupQueue?.close(),
    orphanUploadCleanupQueue?.close(),
    databaseBackupQueue?.close(),
  ]);
  dedupQueue = null;
  thumbnailsQueue = null;
  metadataQueue = null;
  srtFlightPathQueue = null;
  webTranscodingQueue = null;
  panoramaStitchQueue = null;
  sequenceExportQueue = null;
  integrityCheckQueue = null;
  binCleanupQueue = null;
  orphanUploadCleanupQueue = null;
  databaseBackupQueue = null;
}
