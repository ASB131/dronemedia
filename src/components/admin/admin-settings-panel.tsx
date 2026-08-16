"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SettingsView = {
  server: { host: string; port: number; publicUrl: string };
  users: { inviteOnly: boolean; defaultStorageQuotaBytes: number };
  logging: { level: string };
  upload: {
    maxFileSizeBytes: number;
    chunkSizeBytes: number;
    incompleteUploadTtlHours: number;
  };
  deduplication: { algorithm: string; onDuplicate: string };
  bin: { purgeAfterDays: number };
  images: {
    thumbnailMaxEdge: number;
    thumbnailQuality: number;
    webMaxEdge?: number;
    webQuality?: number;
  };
  nightly: {
    binCleanupCron: string;
    orphanUploadCleanupCron: string;
    integrityCheckCron: string;
  };
  jobs: {
    concurrency: Record<string, number>;
    gates?: { webTranscoding: boolean; panoramaStitch: boolean };
  };
  playback?: { allowInAppSource: boolean };
  theme: { default: "light" | "dark" | "system"; accent?: string };
  backup?: { enabled: boolean; cron: string; retainDays: number };
  transcoding: {
    hwAccel: "none" | "qsv" | "nvenc" | "vaapi";
    proxy: { maxHeight: number; videoCodec: string; audioCodec: string };
    hls: {
      segmentDurationSeconds: number;
      playlistType: "vod" | "event";
      heights?: number[];
    };
    sequences?: { fps: number; fullResCrf: number; fullResPreset: string };
  };
  notifications: {
    sse: { enabled: boolean; heartbeatIntervalSeconds: number };
    polling: { enabled: boolean; fallbackIntervalSeconds: number };
  };
  versionCheck: { enabled: boolean; latest?: string };
  auth: {
    login: { maxAttempts: number; lockoutBaseSeconds: number };
  };
  storage: {
    appDataPath: string;
    cachePath: string;
    mediaPath: string;
    adapter: string;
  };
};

function gbFromBytes(bytes: number) {
  return Number((bytes / 1024 ** 3).toFixed(2));
}

function bytesFromGb(gb: number) {
  return Math.round(gb * 1024 ** 3);
}

export function AdminSettingsPanel() {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [quotaGb, setQuotaGb] = useState("100");
  const [purgeDays, setPurgeDays] = useState("30");
  const [maxHeight, setMaxHeight] = useState("1080");
  const [segmentSeconds, setSegmentSeconds] = useState("4");
  const [maxAttempts, setMaxAttempts] = useState("5");
  const [lockoutSeconds, setLockoutSeconds] = useState("30");
  const [accent, setAccent] = useState("#4250AF");
  const [backupCron, setBackupCron] = useState("0 3 * * *");
  const [backupRetain, setBackupRetain] = useState("14");
  const [thumbEdge, setThumbEdge] = useState("480");
  const [thumbQuality, setThumbQuality] = useState("80");
  const [binCron, setBinCron] = useState("0 3 * * *");
  const [orphanCron, setOrphanCron] = useState("0 * * * *");
  const [integrityCron, setIntegrityCron] = useState("0 4 * * 0");
  const [publicUrl, setPublicUrl] = useState("");
  const [maxFileGb, setMaxFileGb] = useState("80");
  const [hlsHeightSet, setHlsHeightSet] = useState<Set<number>>(
    () => new Set([1080, 1440]),
  );
  const [deletingHeight, setDeletingHeight] = useState<number | null>(null);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const [concurrencyDraft, setConcurrencyDraft] = useState<Record<string, string>>(
    {},
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function applyLocal(view: SettingsView) {
    setSettings(view);
    setQuotaGb(String(gbFromBytes(view.users.defaultStorageQuotaBytes)));
    setPurgeDays(String(view.bin.purgeAfterDays));
    setMaxHeight(String(view.transcoding.proxy.maxHeight));
    setSegmentSeconds(String(view.transcoding.hls.segmentDurationSeconds));
    setMaxAttempts(String(view.auth.login.maxAttempts));
    setLockoutSeconds(String(view.auth.login.lockoutBaseSeconds));
    setAccent(view.theme.accent ?? "#4250AF");
    setBackupCron(view.backup?.cron ?? "0 3 * * *");
    setBackupRetain(String(view.backup?.retainDays ?? 14));
    setThumbEdge(String(view.images?.thumbnailMaxEdge ?? 480));
    setThumbQuality(String(view.images?.thumbnailQuality ?? 80));
    setBinCron(view.nightly?.binCleanupCron ?? "0 3 * * *");
    setOrphanCron(view.nightly?.orphanUploadCleanupCron ?? "0 * * * *");
    setIntegrityCron(view.nightly?.integrityCheckCron ?? "0 4 * * 0");
    setPublicUrl(view.server?.publicUrl ?? "");
    setMaxFileGb(String(gbFromBytes(view.upload?.maxFileSizeBytes ?? 80 * 1024 ** 3)));
    setHlsHeightSet(
      new Set(
        (view.transcoding.hls.heights ?? [1080, 1440]).filter((n) =>
          [720, 1080, 1440].includes(n),
        ),
      ),
    );
    const nextConcurrency: Record<string, string> = {};
    for (const [key, value] of Object.entries(view.jobs?.concurrency ?? {})) {
      nextConcurrency[key] = String(value);
    }
    setConcurrencyDraft(nextConcurrency);
  }

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/admin/settings");
      if (!response.ok) {
        setError("Failed to load settings");
        return;
      }
      const payload = (await response.json()) as { settings: SettingsView };
      applyLocal(payload.settings);
    })();
  }, []);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const response = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(payload?.error ?? "Failed to save settings");
      return;
    }
    const payload = (await response.json()) as { settings: SettingsView };
    applyLocal(payload.settings);
    setMessage("Settings saved to config.yml (app may need restart for some values)");
  }

  if (!settings && !error) {
    return <p className="text-sm text-muted-foreground">Loading settings…</p>;
  }

  if (!settings) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

      <section className="space-y-3 rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold">Server</h2>
        <p className="text-xs text-muted-foreground">
          Public URL used for auth callbacks. In Docker, PUBLIC_URL env usually
          overrides this after restart.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[16rem] flex-1 text-sm">
            Public URL
            <Input
              className="mt-1"
              value={publicUrl}
              onChange={(event) => setPublicUrl(event.target.value)}
            />
          </label>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void save({ server: { publicUrl } })}
          >
            Save URL
          </Button>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold">Upload</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Max file size (GB)
            <Input
              className="mt-1 w-28"
              value={maxFileGb}
              onChange={(event) => setMaxFileGb(event.target.value)}
            />
          </label>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void save({
                upload: {
                  maxFileSizeBytes: bytesFromGb(Number(maxFileGb)),
                },
              })
            }
          >
            Save
          </Button>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          On duplicate
          <select
            className="h-9 rounded-md border border-input bg-background px-2"
            value={settings.deduplication.onDuplicate}
            disabled={busy}
            onChange={(event) =>
              void save({
                deduplication: {
                  onDuplicate: event.target.value as "reject" | "flag",
                },
              })
            }
          >
            <option value="flag">Flag (keep both → Utilities)</option>
            <option value="reject">Reject upload</option>
          </select>
        </label>
      </section>

      <section className="space-y-3 rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold">Playback &amp; video previews</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.playback?.allowInAppSource !== false}
            disabled={busy}
            onChange={(event) =>
              void save({
                playback: { allowInAppSource: event.target.checked },
              })
            }
          />
          Allow in-app Source (camera original)
        </label>
        <p className="text-xs text-muted-foreground">
          When off, players hide Source. Downloads of originals stay allowed.
          Per-user overrides are in Admin → Users; admins always retain Source.
        </p>
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-sm font-medium">Streaming preview qualities</p>
          <p className="text-xs text-muted-foreground">
            New uploads only generate the ticked resolutions. Unticking does not
            delete existing cache — use the delete buttons below for that.
          </p>
          <div className="flex flex-wrap gap-4">
            {([720, 1080, 1440] as const).map((height) => (
              <label key={height} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={hlsHeightSet.has(height)}
                  disabled={busy}
                  onChange={(event) => {
                    setHlsHeightSet((prev) => {
                      const next = new Set(prev);
                      if (event.target.checked) next.add(height);
                      else next.delete(height);
                      return next;
                    });
                  }}
                />
                {height}p
              </label>
            ))}
          </div>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              const heights = [720, 1080, 1440].filter((h) =>
                hlsHeightSet.has(h),
              );
              void save({
                transcoding: {
                  hls: {
                    segmentDurationSeconds: Number(segmentSeconds),
                    heights,
                  },
                  proxy: {
                    maxHeight: Math.max(
                      Number(maxHeight) || 1080,
                      ...(heights.length > 0 ? heights : [1080]),
                    ),
                  },
                },
              });
            }}
          >
            Save preview qualities
          </Button>
        </div>
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-sm font-medium">Clear generated previews</p>
          <p className="text-xs text-muted-foreground">
            Deletes that resolution from cache for every video and rewrites HLS
            playlists. Source media is not touched.
          </p>
          <div className="flex flex-wrap gap-2">
            {([720, 1080, 1440] as const).map((height) => (
              <Button
                key={height}
                size="sm"
                variant="outline"
                disabled={busy || deletingHeight != null}
                onClick={() => {
                  if (
                    !window.confirm(
                      `Delete all ${height}p streaming previews site-wide? Source files are kept.`,
                    )
                  ) {
                    return;
                  }
                  void (async () => {
                    setDeletingHeight(height);
                    setCleanupMessage(null);
                    try {
                      const response = await fetch("/api/admin/cache", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          action: "deleteHlsHeight",
                          height,
                        }),
                      });
                      if (!response.ok) {
                        setCleanupMessage(`Failed to delete ${height}p previews`);
                        return;
                      }
                      const payload = (await response.json()) as {
                        assetsTouched?: number;
                        variantsDeleted?: number;
                        playlistsRewritten?: number;
                      };
                      setCleanupMessage(
                        `Deleted ${height}p: ${payload.variantsDeleted ?? 0} folders · ${payload.playlistsRewritten ?? 0} playlists · ${payload.assetsTouched ?? 0} assets`,
                      );
                    } catch {
                      setCleanupMessage(`Failed to delete ${height}p previews`);
                    } finally {
                      setDeletingHeight(null);
                    }
                  })();
                }}
              >
                {deletingHeight === height
                  ? `Deleting ${height}p…`
                  : `Delete all ${height}p`}
              </Button>
            ))}
          </div>
          {cleanupMessage ? (
            <p className="text-xs text-muted-foreground">{cleanupMessage}</p>
          ) : null}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold">Users</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.users.inviteOnly}
            disabled={busy}
            onChange={(event) =>
              void save({ users: { inviteOnly: event.target.checked } })
            }
          />
          Invite-only registration
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Default quota (GB)
            <Input
              className="mt-1 w-28"
              value={quotaGb}
              onChange={(event) => setQuotaGb(event.target.value)}
            />
          </label>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void save({
                users: { defaultStorageQuotaBytes: bytesFromGb(Number(quotaGb)) },
              })
            }
          >
            Save quota
          </Button>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold">Appearance & bin</h2>
        <label className="block text-sm">
          Default theme
          <select
            className="mt-1 block w-40 rounded-md border border-border bg-background px-2 py-1.5"
            value={settings.theme.default}
            disabled={busy}
            onChange={(event) =>
              void save({
                theme: {
                  default: event.target.value as SettingsView["theme"]["default"],
                },
              })
            }
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Accent color
            <Input
              className="mt-1 w-36"
              value={accent}
              onChange={(event) => setAccent(event.target.value)}
              placeholder="#4250AF"
            />
          </label>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void save({ theme: { accent } })}
          >
            Save accent
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Bin purge after (days)
            <Input
              className="mt-1 w-28"
              value={purgeDays}
              onChange={(event) => setPurgeDays(event.target.value)}
            />
          </label>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void save({ bin: { purgeAfterDays: Number(purgeDays) } })
            }
          >
            Save
          </Button>
        </div>
        <label className="block text-sm">
          Log level
          <select
            className="mt-1 block w-40 rounded-md border border-border bg-background px-2 py-1.5"
            value={settings.logging.level}
            disabled={busy}
            onChange={(event) =>
              void save({ logging: { level: event.target.value } })
            }
          >
            {["trace", "debug", "info", "warn", "error", "fatal"].map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.versionCheck.enabled}
            disabled={busy}
            onChange={(event) =>
              void save({ versionCheck: { enabled: event.target.checked } })
            }
          />
          Version check enabled
        </label>
      </section>

      <section className="space-y-3 rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold">Images</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Thumbnail max edge
            <Input
              className="mt-1 w-28"
              value={thumbEdge}
              onChange={(event) => setThumbEdge(event.target.value)}
            />
          </label>
          <label className="text-sm">
            Quality
            <Input
              className="mt-1 w-28"
              value={thumbQuality}
              onChange={(event) => setThumbQuality(event.target.value)}
            />
          </label>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void save({
                images: {
                  thumbnailMaxEdge: Number(thumbEdge),
                  thumbnailQuality: Number(thumbQuality),
                },
              })
            }
          >
            Save
          </Button>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold">Job concurrency</h2>
        <div className="flex flex-wrap gap-3">
          {Object.keys(concurrencyDraft).map((job) => (
            <label key={job} className="text-sm">
              {job}
              <Input
                className="mt-1 w-24"
                value={concurrencyDraft[job] ?? ""}
                onChange={(event) =>
                  setConcurrencyDraft((prev) => ({
                    ...prev,
                    [job]: event.target.value,
                  }))
                }
              />
            </label>
          ))}
        </div>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            const concurrency: Record<string, number> = {};
            for (const [key, value] of Object.entries(concurrencyDraft)) {
              concurrency[key] = Number(value);
            }
            void save({ jobs: { concurrency } });
          }}
        >
          Save concurrency
        </Button>
        <p className="text-xs text-muted-foreground">
          Worker restart required for concurrency changes.
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold">Nightly tasks</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Bin cleanup cron
            <Input
              className="mt-1 w-40"
              value={binCron}
              onChange={(event) => setBinCron(event.target.value)}
            />
          </label>
          <label className="text-sm">
            Orphan upload cron
            <Input
              className="mt-1 w-40"
              value={orphanCron}
              onChange={(event) => setOrphanCron(event.target.value)}
            />
          </label>
          <label className="text-sm">
            Integrity check cron
            <Input
              className="mt-1 w-40"
              value={integrityCron}
              onChange={(event) => setIntegrityCron(event.target.value)}
            />
          </label>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void save({
                nightly: {
                  binCleanupCron: binCron,
                  orphanUploadCleanupCron: orphanCron,
                  integrityCheckCron: integrityCron,
                },
              })
            }
          >
            Save schedule
          </Button>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold">Database backups</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(settings.backup?.enabled)}
            disabled={busy}
            onChange={(event) =>
              void save({ backup: { enabled: event.target.checked } })
            }
          />
          Enable scheduled pg_dump
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Cron
            <Input
              className="mt-1 w-40"
              value={backupCron}
              onChange={(event) => setBackupCron(event.target.value)}
            />
          </label>
          <label className="text-sm">
            Retain days
            <Input
              className="mt-1 w-24"
              value={backupRetain}
              onChange={(event) => setBackupRetain(event.target.value)}
            />
          </label>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void save({
                backup: {
                  cron: backupCron,
                  retainDays: Number(backupRetain),
                },
              })
            }
          >
            Save schedule
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Also snapshot MEDIA_PATH separately. Cache is regenerable.
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold">Transcoding</h2>
        <label className="block text-sm">
          Hardware accel
          <select
            className="mt-1 block w-40 rounded-md border border-border bg-background px-2 py-1.5"
            value={settings.transcoding.hwAccel}
            disabled={busy}
            onChange={(event) =>
              void save({
                transcoding: {
                  hwAccel: event.target
                    .value as SettingsView["transcoding"]["hwAccel"],
                },
              })
            }
          >
            <option value="none">none</option>
            <option value="nvenc">nvenc</option>
            <option value="qsv">qsv</option>
            <option value="vaapi">vaapi</option>
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Proxy max height
            <Input
              className="mt-1 w-28"
              value={maxHeight}
              onChange={(event) => setMaxHeight(event.target.value)}
            />
          </label>
          <label className="text-sm">
            HLS segment (s)
            <Input
              className="mt-1 w-28"
              value={segmentSeconds}
              onChange={(event) => setSegmentSeconds(event.target.value)}
            />
          </label>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void save({
                transcoding: {
                  proxy: { maxHeight: Number(maxHeight) },
                  hls: {
                    segmentDurationSeconds: Number(segmentSeconds),
                    heights: [720, 1080, 1440].filter((h) =>
                      hlsHeightSet.has(h),
                    ),
                  },
                },
              })
            }
          >
            Save
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Preview qualities (720 / 1080 / 1440) are under Playback above. Proxy
          max height caps the progressive MP4 proxy only. Pause/enable
          Transcoding under Admin → Jobs.
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold">Auth & notifications</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Login max attempts
            <Input
              className="mt-1 w-28"
              value={maxAttempts}
              onChange={(event) => setMaxAttempts(event.target.value)}
            />
          </label>
          <label className="text-sm">
            Lockout base (s)
            <Input
              className="mt-1 w-28"
              value={lockoutSeconds}
              onChange={(event) => setLockoutSeconds(event.target.value)}
            />
          </label>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void save({
                auth: {
                  login: {
                    maxAttempts: Number(maxAttempts),
                    lockoutBaseSeconds: Number(lockoutSeconds),
                  },
                },
              })
            }
          >
            Save
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.notifications.sse.enabled}
            disabled={busy}
            onChange={(event) =>
              void save({
                notifications: { sse: { enabled: event.target.checked } },
              })
            }
          />
          SSE notifications
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.notifications.polling.enabled}
            disabled={busy}
            onChange={(event) =>
              void save({
                notifications: { polling: { enabled: event.target.checked } },
              })
            }
          />
          Polling fallback
        </label>
      </section>

      <section className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
        <h2 className="text-sm font-semibold text-foreground">Storage paths</h2>
        <p className="mt-2 break-all">Media: {settings.storage.mediaPath}</p>
        <p className="break-all">Cache: {settings.storage.cachePath}</p>
        <p className="break-all">App data: {settings.storage.appDataPath}</p>
        <p>Adapter: {settings.storage.adapter}</p>
      </section>
    </div>
  );
}
