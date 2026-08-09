import { APP_VERSION, loadConfig } from "@/lib/config";

export type VersionCheckResult = {
  enabled: boolean;
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  checkedAt: string;
};

let cache: { result: VersionCheckResult; expiresAt: number } | null = null;

/**
 * Compare running APP_VERSION to LATEST_APP_VERSION (env) or
 * versionCheck.latest in config when set by the operator.
 */
export async function checkForUpdates(): Promise<VersionCheckResult> {
  const config = loadConfig();
  const now = new Date().toISOString();

  if (!config.versionCheck.enabled) {
    return {
      enabled: false,
      current: APP_VERSION,
      latest: null,
      updateAvailable: false,
      checkedAt: now,
    };
  }

  if (cache && cache.expiresAt > Date.now()) {
    return cache.result;
  }

  const latest =
    process.env.LATEST_APP_VERSION?.trim() ||
    config.versionCheck.latest?.trim() ||
    null;

  const result: VersionCheckResult = {
    enabled: true,
    current: APP_VERSION,
    latest,
    updateAvailable: Boolean(latest && latest !== APP_VERSION),
    checkedAt: now,
  };

  cache = { result, expiresAt: Date.now() + 60 * 60 * 1000 };
  return result;
}
