import { z } from "zod";

const s3ConfigSchema = z.object({
  endpoint: z.string().default(""),
  region: z.string().default("us-east-1"),
  bucket: z.string().default("drone-media"),
  accessKeyId: z.string().default(""),
  secretAccessKey: z.string().default(""),
  forcePathStyle: z.boolean().default(true),
});

const storageSchema = z.object({
  appDataPath: z.string().min(1),
  cachePath: z.string().min(1),
  mediaPath: z.string().min(1),
  adapter: z.enum(["local", "s3"]).default("local"),
  local: z
    .object({
      enabled: z.boolean().default(true),
    })
    .default({ enabled: true }),
  s3: s3ConfigSchema.default({
    endpoint: "",
    region: "us-east-1",
    bucket: "drone-media",
    accessKeyId: "",
    secretAccessKey: "",
    forcePathStyle: true,
  }),
});

export const configSchema = z.object({
  server: z.object({
    host: z.string().default("0.0.0.0"),
    port: z.coerce.number().int().min(1).max(65535).default(2283),
    publicUrl: z.string().url(),
  }),
  logging: z.object({
    level: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal"])
      .default("info"),
  }),
  storage: storageSchema,
  upload: z.object({
    maxFileSizeBytes: z.coerce.number().int().positive(),
    chunkSizeBytes: z.coerce.number().int().positive(),
    incompleteUploadTtlHours: z.coerce.number().int().positive(),
  }),
  deduplication: z.object({
    algorithm: z.enum(["xxhash", "sha256"]).default("xxhash"),
    onDuplicate: z.enum(["reject", "flag"]).default("flag"),
  }),
  users: z.object({
    defaultStorageQuotaBytes: z.coerce.number().int().positive(),
    inviteOnly: z.boolean().default(false),
  }),
  auth: z.object({
    login: z.object({
      maxAttempts: z.coerce.number().int().positive().default(5),
      lockoutBaseSeconds: z.coerce.number().int().positive().default(30),
    }),
  }),
  transcoding: z.object({
    hwAccel: z.enum(["none", "qsv", "nvenc", "vaapi"]).default("none"),
    hls: z.object({
      segmentDurationSeconds: z.coerce.number().int().positive(),
      playlistType: z.enum(["vod", "event"]).default("vod"),
      heights: z
        .array(z.coerce.number().int().positive())
        .min(1)
        .default([1080, 1440]),
    }),
    proxy: z.object({
      maxHeight: z.coerce.number().int().positive(),
      videoCodec: z.string(),
      audioCodec: z.string(),
    }),
    sequences: z
      .object({
        fps: z.coerce.number().positive().default(24),
        fullResCrf: z.coerce.number().int().min(0).max(51).default(17),
        fullResPreset: z.string().default("medium"),
      })
      .default({
        fps: 24,
        fullResCrf: 17,
        fullResPreset: "medium",
      }),
  }),
  notifications: z.object({
    sse: z.object({
      enabled: z.boolean().default(true),
      heartbeatIntervalSeconds: z.coerce.number().int().positive(),
    }),
    polling: z.object({
      enabled: z.boolean().default(true),
      fallbackIntervalSeconds: z.coerce.number().int().positive(),
    }),
  }),
  bin: z.object({
    purgeAfterDays: z.coerce.number().int().positive(),
  }),
  images: z
    .object({
      thumbnailMaxEdge: z.coerce.number().int().positive().default(480),
      thumbnailQuality: z.coerce.number().int().min(40).max(95).default(80),
      webMaxEdge: z.coerce.number().int().positive().default(2048),
      webQuality: z.coerce.number().int().min(40).max(95).default(82),
    })
    .default({
      thumbnailMaxEdge: 480,
      thumbnailQuality: 80,
      webMaxEdge: 2048,
      webQuality: 82,
    }),
  nightly: z.object({
    binCleanupCron: z.string(),
    orphanUploadCleanupCron: z.string(),
    integrityCheckCron: z.string(),
  }),
  database: z.object({
    pool: z.object({
      web: z.object({
        max: z.coerce.number().int().positive(),
        idleTimeoutMs: z.coerce.number().int().positive(),
      }),
      worker: z.object({
        max: z.coerce.number().int().positive(),
        idleTimeoutMs: z.coerce.number().int().positive(),
      }),
    }),
  }),
  redis: z.object({
    url: z.string().default("redis://localhost:6379"),
  }),
  jobs: z.object({
    concurrency: z.record(z.string(), z.coerce.number().int().positive()),
    retry: z.object({
      attempts: z.coerce.number().int().positive(),
      backoffMs: z.coerce.number().int().positive(),
    }),
    /** Global admin gates for heavy post-import work (all users). */
    gates: z
      .object({
        webTranscoding: z.boolean().default(true),
        panoramaStitch: z.boolean().default(true),
      })
      .default({
        webTranscoding: true,
        panoramaStitch: true,
      }),
  }),
  playback: z
    .object({
      /** Allow Web/Source switch to stream camera originals in-app. Downloads stay allowed. */
      allowInAppSource: z.boolean().default(true),
    })
    .default({ allowInAppSource: true }),
  theme: z.object({
    default: z.enum(["light", "dark", "system"]).default("system"),
    accent: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .default("#4250AF"),
  }),
  versionCheck: z.object({
    enabled: z.boolean().default(true),
    latest: z.string().optional(),
  }),
  backup: z
    .object({
      enabled: z.boolean().default(false),
      cron: z.string().default("0 3 * * *"),
      retainDays: z.coerce.number().int().positive().default(14),
    })
    .default({
      enabled: false,
      cron: "0 3 * * *",
      retainDays: 14,
    }),
});

export type AppConfig = z.infer<typeof configSchema>;
