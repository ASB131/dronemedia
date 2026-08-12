"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { DriveImportPanel } from "@/components/upload/drive-import-panel";
import type { MissionTemplateDto } from "@/lib/missions/queries";
import {
  formatUploadBytes,
  parseBasename,
  type UploadFileState,
} from "@/lib/upload/client";
import { collectFilesFromDataTransfer } from "@/lib/upload/relative-path";
import {
  MAX_UPLOAD_BATCH_FILES,
  MAX_UPLOAD_BATCH_GB,
} from "@/lib/upload/validators";
import { useUploadStore } from "@/stores/upload-store";

const DEFAULT_MAX_FILE_BYTES = 80 * 1024 * 1024 * 1024;

function UploadFileRow({ file }: { file: UploadFileState }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{file.file.name}</p>
          <p className="text-xs text-muted-foreground">
            {formatUploadBytes(file.file.size)} • {file.status}
          </p>
          {file.missingLinked && file.missingLinked.length > 0 ? (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              Optional linked files missing: {file.missingLinked.join(", ")}
            </p>
          ) : null}
          {file.error ? (
            <p className="mt-1 text-xs text-destructive">{file.error}</p>
          ) : null}
        </div>
        <div className="w-24 text-right text-sm tabular-nums">
          {Math.round(file.progress * 100)}%
        </div>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${Math.round(file.progress * 100)}%` }}
        />
      </div>
    </div>
  );
}

export function UploadZone() {
  const batch = useUploadStore((s) => s.batch);
  const pendingFiles = useUploadStore((s) => s.pendingFiles);
  const notice = useUploadStore((s) => s.notice);
  const bulkMode = useUploadStore((s) => s.bulkMode);
  const waveInfo = useUploadStore((s) => s.waveInfo);
  const queueFiles = useUploadStore((s) => s.queueFiles);
  const setBatchError = useCallback((error: string) => {
    useUploadStore.setState({
      batch: {
        batchId: undefined,
        files: [],
        status: "error",
        error,
      },
      dockDismissed: false,
      dockExpanded: true,
    });
  }, []);
  const setNotice = useUploadStore((s) => s.setNotice);
  const setBulkMode = useUploadStore((s) => s.setBulkMode);
  const reset = useUploadStore((s) => s.reset);

  const [isDragging, setIsDragging] = useState(false);
  const [templates, setTemplates] = useState<MissionTemplateDto[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>(
    {},
  );
  const [maxFileSizeBytes, setMaxFileSizeBytes] = useState(
    DEFAULT_MAX_FILE_BYTES,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/missions");
      if (!response.ok) return;
      const payload = (await response.json()) as {
        templates: MissionTemplateDto[];
      };
      setTemplates(payload.templates);
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/account");
        if (!response.ok) return;
        const payload = (await response.json()) as {
          upload?: { maxFileSizeBytes?: number };
        };
        if (payload.upload?.maxFileSizeBytes) {
          setMaxFileSizeBytes(payload.upload.maxFileSizeBytes);
        }
      } catch {
        // Keep default ~80 GB copy.
      }
    })();
  }, []);

  const activeTemplate =
    templates.find((template) => template.id === templateId) ?? null;

  useEffect(() => {
    if (!activeTemplate) {
      setCheckedItems({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const item of activeTemplate.checklist) {
      next[item.id] = false;
    }
    setCheckedItems(next);
  }, [activeTemplate]);

  const checklistReady =
    !activeTemplate ||
    activeTemplate.checklist.every(
      (item) => !item.required || checkedItems[item.id],
    );

  const enqueueValidated = useCallback(
    (incoming: File[]) => {
      if (incoming.length === 0) return;

      const oversized = incoming.filter(
        (file) => file.size > maxFileSizeBytes,
      );
      if (oversized.length > 0) {
        setNotice(
          `${oversized.length} file${oversized.length === 1 ? "" : "s"} exceed the ${formatUploadBytes(maxFileSizeBytes)} limit and were not queued.`,
        );
      }
      const selected = incoming.filter(
        (file) => file.size <= maxFileSizeBytes,
      );
      if (selected.length === 0) return;

      if (activeTemplate) {
        const basenames = new Set(
          selected.map((file) => parseBasename(file.name).basename),
        );
        if (activeTemplate.requireSrt) {
          for (const basename of basenames) {
            const hasMedia = selected.some((file) => {
              const parsed = parseBasename(file.name);
              return (
                parsed.basename === basename &&
                !["srt", "lrf"].includes(parsed.extension.toLowerCase())
              );
            });
            const hasSrt = selected.some((file) => {
              const parsed = parseBasename(file.name);
              return (
                parsed.basename === basename &&
                parsed.extension.toLowerCase() === "srt"
              );
            });
            if (hasMedia && !hasSrt) {
              setBatchError(
                `Mission template requires SRT for each clip (missing for ${basename}).`,
              );
              return;
            }
          }
        }
        if (!checklistReady) {
          setBatchError("Complete the mission checklist before uploading.");
          return;
        }
      }

      queueFiles(selected);
    },
    [
      activeTemplate,
      checklistReady,
      maxFileSizeBytes,
      queueFiles,
      setBatchError,
      setNotice,
    ],
  );

  const onInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const list = event.target.files ? [...event.target.files] : [];
    enqueueValidated(list);
    event.target.value = "";
  };

  const onDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const collected = await collectFilesFromDataTransfer(event.dataTransfer);
    if (collected.length === 0) {
      setNotice(
        "No files detected in that drop. Try Choose files / Choose folder, or drag again.",
      );
      return;
    }
    enqueueValidated(collected);
  };

  const overallProgress = useMemo(() => {
    if (batch.files.length === 0) return 0;
    return (
      batch.files.reduce((sum, file) => sum + file.progress, 0) /
      batch.files.length
    );
  }, [batch.files]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upload</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Import from an SD card or drone, or drop files below. Linked
          basenames (video + SRT/LRF) and hyperlapse/panorama folders are
          grouped. Panoramas pair PANORAMA/100_XXXX tiles with
          100MEDIA/DJI_XXXX.JPG when both are present — or when uploaded at
          different times (stitch first, tiles later).
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Limits: up to {MAX_UPLOAD_BATCH_FILES} files or ~{MAX_UPLOAD_BATCH_GB}{" "}
          GB per wave · up to {formatUploadBytes(maxFileSizeBytes)} per file ·
          uploads continue in the dock while you browse. Closing this tab stops
          the transfer.
        </p>
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-border p-4 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={bulkMode}
          onChange={(event) => setBulkMode(event.target.checked)}
        />
        <span>
          <span className="font-medium">Bulk import mode</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            For large card dumps (~tens to hundreds of GB). Keep this browser
            tab open; progress stays in the bottom-right dock. Admins can pause
            heavy processing jobs in Utilities during the import if the server
            gets busy.
          </span>
        </span>
      </label>

      {templates.length > 0 ? (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Mission template
            </label>
            <select
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">None</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>
          {activeTemplate ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {activeTemplate.requireSrt ? "SRT required · " : ""}
                {activeTemplate.requireLrf ? "LRF required · " : ""}
                {activeTemplate.defaultTags.length
                  ? `Tags: ${activeTemplate.defaultTags.join(", ")}`
                  : "No default tags"}
              </p>
              {activeTemplate.checklist.map((item) => (
                <label
                  key={item.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(checkedItems[item.id])}
                    onChange={(event) =>
                      setCheckedItems((current) => ({
                        ...current,
                        [item.id]: event.target.checked,
                      }))
                    }
                  />
                  {item.label}
                  {item.required ? (
                    <span className="text-[10px] text-muted-foreground">
                      required
                    </span>
                  ) : null}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <DriveImportPanel
        onQueueFiles={enqueueValidated}
        requireSrt={Boolean(activeTemplate?.requireSrt)}
      />

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={`flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center transition-colors ${
          isDragging ? "border-primary bg-primary/5" : "border-border"
        }`}
      >
        <p className="text-sm font-medium">Or drag files / folders here</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Manual upload · paths preserved for hyperlapse/panorama detection
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={onInputChange}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          // @ts-expect-error non-standard directory picker attributes
          webkitdirectory=""
          directory=""
          onChange={onInputChange}
        />
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            Browse files
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => folderInputRef.current?.click()}
          >
            Browse folder
          </Button>
        </div>
      </div>

      {notice ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      {pendingFiles.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {pendingFiles.length} file{pendingFiles.length === 1 ? "" : "s"} queued
          {batch.status === "uploading" || batch.status === "committing"
            ? " for the next batch"
            : " — starting shortly…"}
          {waveInfo ? ` · wave ${waveInfo.waveNumber}` : ""}
        </p>
      ) : null}

      {batch.status !== "idle" ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="capitalize text-muted-foreground">
              Batch status: {batch.status}
              {batch.files.length > 0 ? ` · ${batch.files.length} files` : ""}
            </span>
            <span>{Math.round(overallProgress * 100)}%</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Live progress also stays in the upload dock (bottom right) while you
            browse the library.
          </p>
          {batch.error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {batch.error}
            </p>
          ) : null}
          {batch.files.map((file) => (
            <UploadFileRow key={file.localId} file={file} />
          ))}
          {batch.status === "done" || batch.status === "error" ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
              }}
            >
              Clear list
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
