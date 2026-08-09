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
  const [message, setMessage] = useState<string | null>(null);

  async function reload() {
    const response = await fetch("/api/admin/ops?view=jobs");
    if (!response.ok) return;
    const payload = (await response.json()) as { failures: JobFailure[] };
    setFailures(payload.failures);
  }

  useEffect(() => {
    void reload();
  }, []);

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
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">Failed jobs</h2>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
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
          <li className="text-sm text-muted-foreground">No unresolved failures.</li>
        ) : null}
      </ul>
    </div>
  );
}
