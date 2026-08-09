export const JOB_NAMES = {
  DEDUP: "dedup",
  THUMBNAILS: "thumbnails",
  METADATA: "metadata",
  SRT_FLIGHT_PATH: "srtFlightPath",
  WEB_TRANSCODING: "webTranscoding",
  PANORAMA_STITCH: "panoramaStitch",
  SEQUENCE_EXPORT: "sequenceExport",
  BIN_CLEANUP: "binCleanup",
  ORPHAN_UPLOAD_CLEANUP: "orphanUploadCleanup",
  INTEGRITY_CHECK: "integrityCheck",
  DATABASE_BACKUP: "databaseBackup",
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

export type DedupJobData = {
  userId: string;
  assetId: string;
  onDuplicate: "reject" | "flag";
};

export type AssetJobData = {
  userId: string;
  assetId: string;
};

export type JobEventPayload = {
  userId: string;
  jobType: JobName;
  assetId?: string;
  /** Display name for per-file notification grouping. */
  assetName?: string;
  status: "queued" | "processing" | "complete" | "failed";
  message?: string;
  timestamp: string;
};
