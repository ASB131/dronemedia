"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type AuditLog = {
  id: string;
  actionType: string;
  targetType: string;
  targetId: string | null;
  createdAt: string;
  actorUsername: string | null;
};

type JobFailure = {
  id: string;
  jobType: string;
  entityType: string | null;
  entityId: string | null;
  errorDetail: string;
  attemptCount: number;
  createdAt: string;
};

export function AdminAuditPanel() {
  const [logs, setLogs] = useState<AuditLog[]>([]);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/admin/ops?view=audit");
      if (!response.ok) return;
      const payload = (await response.json()) as { logs: AuditLog[] };
      setLogs(payload.logs);
    })();
  }, []);

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">Audit log</h2>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {logs.map((log) => (
          <li key={log.id} className="px-4 py-3 text-sm">
            <p>
              <span className="font-medium">{log.actorUsername ?? "system"}</span>{" "}
              · {log.actionType}
            </p>
            <p className="text-xs text-muted-foreground">
              {log.targetType}
              {log.targetId ? ` · ${log.targetId}` : ""} ·{" "}
              {new Date(log.createdAt).toLocaleString()}
            </p>
          </li>
        ))}
        {logs.length === 0 ? (
          <li className="px-4 py-6 text-sm text-muted-foreground">No audit events yet.</li>
        ) : null}
      </ul>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

type StorageSummaryRow = {
  id: string;
  label: string;
  path: string;
  bytes: number;
};

type StorageReport = {
  summary: StorageSummaryRow[];
  media: {
    path: string;
    bytes: number;
    children: { name: string; bytes: number }[];
  };
  cache: {
    cachePath: string;
    bytes: Record<string, number>;
  };
  app: { path: string; bytes: number };
  postgres: { bytes: number };
  redis: { bytes: number };
};

export function AdminCachePanel() {
  const [report, setReport] = useState<StorageReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/admin/cache");
      if (!response.ok) {
        setError("Failed to load storage report");
        return;
      }
      const payload = (await response.json()) as StorageReport;
      setReport(payload);
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold">Storage</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          High-level disk use across media, cache, database, and app data.
          Postgres size is the logical database size. Redis is process
          used_memory, not the Docker volume.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!report && !error ? (
        <p className="text-sm text-muted-foreground">Measuring storage…</p>
      ) : null}
      {report ? (
        <>
          <div className="space-y-2 rounded-xl border border-border p-4 text-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Overview
            </h3>
            <dl className="space-y-2">
              {report.summary.map((row) => (
                <div key={row.id} className="flex justify-between gap-3">
                  <dt>
                    <span className="font-medium">{row.label}</span>
                    <span className="mt-0.5 block break-all text-xs text-muted-foreground">
                      {row.path}
                    </span>
                  </dt>
                  <dd className="shrink-0 tabular-nums font-medium">
                    {formatBytes(row.bytes)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="space-y-2 rounded-xl border border-border p-4 text-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Media (bulk)
            </h3>
            <p className="break-all text-xs text-muted-foreground">
              {report.media.path}
            </p>
            <dl className="grid gap-1.5 sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">total</dt>
                <dd className="tabular-nums font-medium">
                  {formatBytes(report.media.bytes)}
                </dd>
              </div>
              {report.media.children.map((child) => (
                <div key={child.name} className="flex justify-between gap-3">
                  <dt className="truncate text-muted-foreground" title={child.name}>
                    {child.name}
                  </dt>
                  <dd className="tabular-nums font-medium">
                    {formatBytes(child.bytes)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="space-y-2 rounded-xl border border-border p-4 text-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Regenerable cache
            </h3>
            <p className="break-all text-xs text-muted-foreground">
              {report.cache.cachePath}
            </p>
            <dl className="grid gap-1.5 sm:grid-cols-2">
              {Object.entries(report.cache.bytes).map(([key, value]) => (
                <div key={key} className="flex justify-between gap-3">
                  <dt className="capitalize text-muted-foreground">{key}</dt>
                  <dd className="tabular-nums font-medium">
                    {formatBytes(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function AdminJobsPanel() {
  const [failures, setFailures] = useState<JobFailure[]>([]);
  const [gates, setGates] = useState({
    webTranscoding: true,
    panoramaStitch: true,
  });
  const [status, setStatus] = useState<{
    totals: {
      waiting: number;
      active: number;
      delayed: number;
      failed: number;
    };
    queues: Array<{
      name: string;
      label: string;
      paused: boolean;
      counts: {
        waiting: number;
        active: number;
        delayed: number;
        failed: number;
      };
    }>;
    active: Array<{
      id: string;
      queueLabel: string;
      assetName: string | null;
      userId: string | null;
      state: string;
    }>;
    waiting: Array<{
      id: string;
      queueLabel: string;
      assetName: string | null;
      userId: string | null;
    }>;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyGate, setBusyGate] = useState<string | null>(null);

  async function reload() {
    const response = await fetch("/api/admin/jobs");
    if (!response.ok) {
      // Fallback to legacy failed-jobs endpoint
      const legacy = await fetch("/api/admin/ops?view=jobs");
      if (!legacy.ok) return;
      const payload = (await legacy.json()) as { failures: JobFailure[] };
      setFailures(payload.failures);
      return;
    }
    const payload = (await response.json()) as {
      failures: JobFailure[];
      gates: { webTranscoding: boolean; panoramaStitch: boolean };
      status: NonNullable<typeof status>;
    };
    setFailures(payload.failures);
    setGates(payload.gates);
    setStatus(payload.status);
  }

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 8000);
    return () => window.clearInterval(timer);
  }, []);

  async function setGate(
    gate: "webTranscoding" | "panoramaStitch",
    enabled: boolean,
  ) {
    setMessage(null);
    setBusyGate(gate);
    const response = await fetch("/api/admin/jobs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gate, enabled }),
    });
    setBusyGate(null);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setMessage(payload?.error ?? "Failed to update job gate");
      return;
    }
    const payload = (await response.json()) as {
      backfilled?: number;
      enabled: boolean;
      failures: JobFailure[];
      gates: { webTranscoding: boolean; panoramaStitch: boolean };
      status: NonNullable<typeof status>;
    };
    setFailures(payload.failures);
    setGates(payload.gates);
    setStatus(payload.status);
    const label = gate === "webTranscoding" ? "Transcoding" : "Panorama stitch";
    if (payload.enabled) {
      setMessage(
        `${label} enabled${
          payload.backfilled
            ? ` — queued ${payload.backfilled} job${payload.backfilled === 1 ? "" : "s"}`
            : ""
        }.`,
      );
    } else {
      setMessage(
        `${label} paused — new uploads will skip this step until re-enabled.`,
      );
    }
  }

  async function act(failureId: string, action: "resolve" | "retry") {
    setMessage(null);
    const response = await fetch("/api/admin/ops", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ failureId, action }),
    });
    if (!response.ok) {
      setMessage("Action failed");
      return;
    }
    setMessage(action === "retry" ? "Retried" : "Resolved");
    await reload();
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Job gates</h2>
        <p className="text-xs text-muted-foreground">
          Pause heavy post-import work during bulk uploads. Applies to all
          users. Enabling queues every asset that still needs that job.
        </p>
        {message ? (
          <p className="text-xs text-muted-foreground">{message}</p>
        ) : null}
        <div className="space-y-3 rounded-xl border border-border p-4">
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              <span className="font-medium">Transcoding</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                HLS / proxy for videos and sequences
              </span>
            </span>
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={gates.webTranscoding}
              disabled={busyGate !== null}
              onChange={(event) =>
                void setGate("webTranscoding", event.target.checked)
              }
            />
          </label>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              <span className="font-medium">Panorama stitch</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Equirect preview for panorama sequences
              </span>
            </span>
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={gates.panoramaStitch}
              disabled={busyGate !== null}
              onChange={(event) =>
                void setGate("panoramaStitch", event.target.checked)
              }
            />
          </label>
        </div>
      </section>

      {status ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Global queue</h2>
          <p className="text-xs text-muted-foreground">
            Active {status.totals.active} · Waiting {status.totals.waiting} ·
            Delayed {status.totals.delayed} · Failed {status.totals.failed}
          </p>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[32rem] text-left text-xs">
              <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Queue</th>
                  <th className="px-3 py-2 font-medium">Waiting</th>
                  <th className="px-3 py-2 font-medium">Active</th>
                  <th className="px-3 py-2 font-medium">Failed</th>
                  <th className="px-3 py-2 font-medium">Paused</th>
                </tr>
              </thead>
              <tbody>
                {status.queues.map((queue) => (
                  <tr key={queue.name} className="border-b border-border/60">
                    <td className="px-3 py-2 font-medium">{queue.label}</td>
                    <td className="px-3 py-2">{queue.counts.waiting}</td>
                    <td className="px-3 py-2">{queue.counts.active}</td>
                    <td className="px-3 py-2">{queue.counts.failed}</td>
                    <td className="px-3 py-2">
                      {queue.paused ? "Yes" : "No"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Active (all users)
              </p>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
                {status.active.slice(0, 40).map((job) => (
                  <li key={job.id}>
                    {job.queueLabel}: {job.assetName ?? job.id.slice(0, 8)}
                    {job.userId ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {job.userId.slice(0, 8)}
                      </span>
                    ) : null}
                  </li>
                ))}
                {status.active.length === 0 ? (
                  <li className="text-muted-foreground">None</li>
                ) : null}
              </ul>
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Waiting (all users)
              </p>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
                {status.waiting.slice(0, 40).map((job) => (
                  <li key={job.id}>
                    {job.queueLabel}: {job.assetName ?? job.id.slice(0, 8)}
                    {job.userId ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {job.userId.slice(0, 8)}
                      </span>
                    ) : null}
                  </li>
                ))}
                {status.waiting.length === 0 ? (
                  <li className="text-muted-foreground">None</li>
                ) : null}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Failed jobs</h2>
        <ul className="space-y-2">
          {failures.map((failure) => (
            <li
              key={failure.id}
              className="rounded-xl border border-border p-3 text-sm"
            >
              <p className="font-medium">{failure.jobType}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {failure.errorDetail}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Attempts: {failure.attemptCount} ·{" "}
                {new Date(failure.createdAt).toLocaleString()}
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void act(failure.id, "retry")}
                >
                  Retry
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void act(failure.id, "resolve")}
                >
                  Dismiss
                </Button>
              </div>
            </li>
          ))}
          {failures.length === 0 ? (
            <li className="text-sm text-muted-foreground">
              No unresolved failures.
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
