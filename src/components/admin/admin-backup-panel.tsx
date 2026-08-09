"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

export function AdminBackupPanel() {
  const [files, setFiles] = useState<
    Array<{ name: string; sizeBytes: number; createdAt: string }>
  >([]);
  const [mediaPath, setMediaPath] = useState("");
  const [backupDir, setBackupDir] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const response = await fetch("/api/admin/backup");
    if (!response.ok) return;
    const payload = (await response.json()) as {
      files: typeof files;
      mediaPath: string;
      backupDir: string;
    };
    setFiles(payload.files);
    setMediaPath(payload.mediaPath);
    setBackupDir(payload.backupDir);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function runBackup() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/admin/backup", { method: "POST" });
    setBusy(false);
    if (!response.ok) {
      setMessage("Backup failed — is pg_dump available in the app container?");
      return;
    }
    const payload = (await response.json()) as {
      fileName: string;
      note: string;
    };
    setMessage(`${payload.fileName} created. ${payload.note}`);
    await reload();
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Database dump</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Runs a plain-SQL <code className="text-xs">pg_dump</code> into{" "}
          <code className="text-xs">{backupDir || "APP_DATA_PATH/backups"}</code>.
          Snapshot <code className="text-xs">{mediaPath || "MEDIA_PATH"}</code>{" "}
          separately. Cache is regenerable.
        </p>
      </div>
      <Button disabled={busy} onClick={() => void runBackup()}>
        {busy ? "Dumping…" : "Run database backup"}
      </Button>
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      <section className="dm-panel-enter rounded-xl border border-border bg-muted/20 p-4">
        <h3 className="text-sm font-semibold">Restore a database dump</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Stop the app or put it in maintenance mode so no writes occur.</li>
          <li>
            Restore into an empty target database, then start the app after the
            restore completes.
          </li>
          <li>
            Run this from a host or container that has PostgreSQL client tools
            and can reach the database:
          </li>
        </ol>
        <code className="mt-2 block overflow-x-auto rounded-md bg-background px-3 py-2 text-xs text-foreground">
          {"psql --dbname=\"$DATABASE_URL\" --set=ON_ERROR_STOP=1 --file=/path/to/drone-media-YYYY-MM-DDTHH-MM-SS-sssZ.sql"}
        </code>
        <p className="mt-2 text-xs text-muted-foreground">
          These backups are plain SQL, created without owners or ACLs; use{" "}
          <code>psql</code>, not <code>pg_restore</code>. Restore{" "}
          <code>MEDIA_PATH</code> separately from its filesystem or object-storage
          backup. <code>CACHE_PATH</code> does not need restoring because it is
          regenerated.
        </p>
      </section>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {files.map((file) => (
          <li
            key={file.name}
            className="flex justify-between gap-3 px-4 py-3 text-sm"
          >
            <span className="truncate">{file.name}</span>
            <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <span>
                {(file.sizeBytes / (1024 * 1024)).toFixed(1)} MB ·{" "}
                {new Date(file.createdAt).toLocaleString()}
              </span>
              <a
                className="font-medium text-primary hover:underline"
                href={`/api/admin/backup?file=${encodeURIComponent(file.name)}`}
              >
                Download
              </a>
            </span>
          </li>
        ))}
        {files.length === 0 ? (
          <li className="px-4 py-6 text-sm text-muted-foreground">
            No dumps yet.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
