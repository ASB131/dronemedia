import fs from "node:fs";
import path from "node:path";

import yaml from "yaml";

import { type AppConfig, configSchema } from "./schema";

let cachedConfig: AppConfig | null = null;

function resolveConfigPath(): string {
  return process.env.CONFIG_PATH ?? path.join(process.cwd(), "config.yml");
}

function applyEnvOverrides(raw: Record<string, unknown>): Record<string, unknown> {
  const merged = structuredClone(raw);

  const storage = (merged.storage ?? {}) as Record<string, unknown>;
  if (process.env.APP_DATA_PATH) storage.appDataPath = process.env.APP_DATA_PATH;
  if (process.env.CACHE_PATH) storage.cachePath = process.env.CACHE_PATH;
  if (process.env.MEDIA_PATH) storage.mediaPath = process.env.MEDIA_PATH;
  merged.storage = storage;

  const server = (merged.server ?? {}) as Record<string, unknown>;
  if (process.env.HOST) server.host = process.env.HOST;
  if (process.env.PORT) server.port = Number(process.env.PORT);
  if (process.env.PUBLIC_URL) server.publicUrl = process.env.PUBLIC_URL;
  merged.server = server;

  const logging = (merged.logging ?? {}) as Record<string, unknown>;
  if (process.env.LOG_LEVEL) logging.level = process.env.LOG_LEVEL;
  merged.logging = logging;

  const redis = (merged.redis ?? {}) as Record<string, unknown>;
  if (process.env.REDIS_URL) redis.url = process.env.REDIS_URL;
  merged.redis = redis;

  return merged;
}

export function loadConfig(forceReload = false): AppConfig {
  if (cachedConfig && !forceReload) {
    return cachedConfig;
  }

  const configPath = resolveConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const fileContents = fs.readFileSync(configPath, "utf8");
  const parsed = yaml.parse(fileContents) as Record<string, unknown>;
  const withEnv = applyEnvOverrides(parsed);
  cachedConfig = configSchema.parse(withEnv);

  return cachedConfig;
}

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return url;
}

export function getRedisUrl(): string {
  return process.env.REDIS_URL ?? loadConfig().redis.url;
}

export const APP_VERSION = process.env.APP_VERSION ?? "1.0.5";
