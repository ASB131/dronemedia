import fs from "node:fs";
import path from "node:path";

import yaml from "yaml";

import { type AppConfig, configSchema } from "@/lib/config/schema";
import { loadConfig } from "@/lib/config";

function resolveConfigPath(): string {
  return process.env.CONFIG_PATH ?? path.join(process.cwd(), "config.yml");
}

/** Public admin view of operator settings (secrets redacted). */
export function getAdminSettingsView() {
  const config = loadConfig();
  return {
    server: {
      host: config.server.host,
      port: config.server.port,
      publicUrl: config.server.publicUrl,
    },
    logging: config.logging,
    users: config.users,
    auth: config.auth,
    upload: config.upload,
    deduplication: config.deduplication,
    transcoding: config.transcoding,
    notifications: config.notifications,
    bin: config.bin,
    images: config.images,
    nightly: config.nightly,
    jobs: config.jobs,
    playback: config.playback,
    theme: config.theme,
    versionCheck: config.versionCheck,
    backup: config.backup,
    storage: {
      appDataPath: config.storage.appDataPath,
      cachePath: config.storage.cachePath,
      mediaPath: config.storage.mediaPath,
      adapter: config.storage.adapter,
    },
  };
}

export type AdminSettingsPatch = {
  server?: { publicUrl?: string };
  users?: { inviteOnly?: boolean; defaultStorageQuotaBytes?: number };
  logging?: { level?: AppConfig["logging"]["level"] };
  upload?: {
    maxFileSizeBytes?: number;
    chunkSizeBytes?: number;
    incompleteUploadTtlHours?: number;
  };
  deduplication?: {
    algorithm?: AppConfig["deduplication"]["algorithm"];
    onDuplicate?: AppConfig["deduplication"]["onDuplicate"];
  };
  bin?: { purgeAfterDays?: number };
  images?: {
    thumbnailMaxEdge?: number;
    thumbnailQuality?: number;
    webMaxEdge?: number;
    webQuality?: number;
  };
  nightly?: {
    binCleanupCron?: string;
    orphanUploadCleanupCron?: string;
    integrityCheckCron?: string;
  };
  jobs?: {
    concurrency?: Record<string, number>;
    gates?: {
      webTranscoding?: boolean;
      panoramaStitch?: boolean;
    };
  };
  playback?: { allowInAppSource?: boolean };
  theme?: { default?: AppConfig["theme"]["default"]; accent?: string };
  backup?: {
    enabled?: boolean;
    cron?: string;
    retainDays?: number;
  };
  transcoding?: {
    hwAccel?: AppConfig["transcoding"]["hwAccel"];
    proxy?: { maxHeight?: number; videoCodec?: string; audioCodec?: string };
    hls?: {
      segmentDurationSeconds?: number;
      playlistType?: "vod" | "event";
      heights?: number[];
    };
    sequences?: {
      fps?: number;
      fullResCrf?: number;
      fullResPreset?: string;
    };
  };
  notifications?: {
    sse?: { enabled?: boolean; heartbeatIntervalSeconds?: number };
    polling?: { enabled?: boolean; fallbackIntervalSeconds?: number };
  };
  versionCheck?: { enabled?: boolean };
  auth?: {
    login?: { maxAttempts?: number; lockoutBaseSeconds?: number };
  };
};

export function patchAdminSettings(patch: AdminSettingsPatch) {
  const configPath = resolveConfigPath();
  const raw = yaml.parse(fs.readFileSync(configPath, "utf8")) as Record<
    string,
    unknown
  >;

  const merged = structuredClone(raw);
  deepMerge(merged, patch as Record<string, unknown>);
  const parsed = configSchema.parse(merged);

  fs.writeFileSync(
    configPath,
    yaml.stringify(parsed, { lineWidth: 0 }),
    "utf8",
  );
  return loadConfig(true);
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
) {
  for (const [key, value] of Object.entries(source)) {
    if (value == null) continue;
    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof target[key] === "object" &&
      target[key] != null &&
      !Array.isArray(target[key])
    ) {
      deepMerge(
        target[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      target[key] = value;
    }
  }
}
