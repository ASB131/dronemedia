"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { IntegrityRunDto } from "@/lib/assets/integrity-check";

export function AdminIntegrityPanel() {
  const [latest, setLatest] = useState<IntegrityRunDto | null>(null);
  const [runs, setRuns] = useState<IntegrityRunDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [queuing, setQueuing] = useState(false);
  const [requeueing, setRequeueing] = useState<"thumbnails" | "hls" | null>(
    null,
  );

  async function load() {
    setLoading(true);
    const response = await fetch("/api/admin/integrity");
    setLoading(false);
    if (!response.ok) {
      setError("Failed to load integrity checks");
      return;
    }
    const payload = (await response.json()) as {
      latest: IntegrityRunDto | null;
      runs: IntegrityRunDto[];
    };
    setLatest(payload.latest);
    setRuns(payload.runs);
    setError(null);
  }

  useEffect(() => {
    void load();
  }, []);

  async function requeueDerivatives(job: "thumbnails" | "hls") {
    const assetIds = [
      ...new Set(latest?.issues.slice(0, 100).map((issue) => issue.assetId)),
    ];
    if (assetIds.length === 0) return;

    setRequeueing(job);
    setMessage(null);
    const response = await fetch("/api/admin/integrity/requeue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds, job }),
    });
    const payload = (await response.json().catch(() => null)) as {
      queued?: number;
      error?: string;
    } | null;
    setRequeueing(null);
    if (!response.ok) {
      setMessage(payload?.error ?? "Failed to requeue derivative jobs");
      return;
    }

    setMessage(
      `${payload?.queued ?? 0} ${job === "hls" ? "HLS" : "thumbnail"} job${payload?.queued === 1 ? "" : "s"} queued`,
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Storage integrity</h2>
          <p className="text-xs text-muted-foreground">
            Weekly checks verify original media files still exist and match
            stored content hashes.
          </p>
        </div>
        <Button
          size="sm"
          disabled={queuing}
          onClick={() => {
            void (async () => {
              setQueuing(true);
              setMessage(null);
              const response = await fetch("/api/admin/integrity", {
                method: "POST",
              });
              setQueuing(false);
              if (!response.ok) {
                setMessage("Failed to queue integrity check");
                return;
              }
              setMessage("Integrity check queued — refresh in a minute");
              window.setTimeout(() => void load(), 3000);
            })();
          }}
        >
          {queuing ? "Queuing…" : "Run check now"}
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? (
        <p className="text-sm text-muted-foreground">{message}</p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !latest ? (
        <p className="text-sm text-muted-foreground">
          No integrity checks have run yet.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Status" value={latest.status} />
          <Stat label="Checked" value={String(latest.checkedCount)} />
          <Stat label="Missing" value={String(latest.missingCount)} />
          <Stat label="Hash mismatch" value={String(latest.hashMismatchCount)} />
        </div>
      )}

      {latest?.issues?.length ? (
        <div className="rounded-xl border border-border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Latest issues ({latest.issues.length})
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Restore missing originals first. Hash mismatches require a
                re-upload of the correct original.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={requeueing !== null}
                onClick={() => void requeueDerivatives("thumbnails")}
              >
                {requeueing === "thumbnails"
                  ? "Queuing…"
                  : "Requeue thumbnails"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={requeueing !== null}
                onClick={() => void requeueDerivatives("hls")}
              >
                {requeueing === "hls" ? "Queuing…" : "Requeue HLS"}
              </Button>
            </div>
          </div>
          <ul className="max-h-64 overflow-auto text-sm">
            {latest.issues.slice(0, 100).map((issue, index) => (
              <li
                key={`${issue.assetId}-${issue.extension}-${index}`}
                className="border-b border-border px-3 py-2 last:border-b-0"
              >
                <span className="font-medium">{issue.reason}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · asset {issue.assetId.slice(0, 8)}… · .{issue.extension}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {runs.length > 0 ? (
        <div className="rounded-xl border border-border">
          <div className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recent runs
          </div>
          <ul className="divide-y divide-border text-sm">
            {runs.map((run) => (
              <li
                key={run.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <span>
                  {new Date(run.startedAt).toLocaleString()} · {run.status} ·{" "}
                  {run.triggeredBy}
                </span>
                <span className="text-muted-foreground">
                  {run.checkedCount} checked · {run.missingCount} missing ·{" "}
                  {run.hashMismatchCount} mismatch
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border px-3 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold capitalize">{value}</p>
    </div>
  );
}
