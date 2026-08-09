"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { DriveImportPanel } from "@/components/upload/drive-import-panel";
import { createClientId } from "@/lib/id";
import type { MissionTemplateDto } from "@/lib/missions/queries";
import {
  commitUploadBatch,
  detectMissingLinkedFiles,
  initUploadBatch,
  parseBasename,
  uploadFileChunks,
  type UploadFileState,
} from "@/lib/upload/client";
import {
  collectFilesFromDataTransfer,
  getFileRelativePath,
} from "@/lib/upload/relative-path";
import { MAX_UPLOAD_BATCH_FILES } from "@/lib/upload/validators";
import { useUploadStore } from "@/stores/upload-store";

function fileKey(file: File) {
  const rel = getFileRelativePath(file) ?? file.name;
  return `${rel}::${file.size}::${file.lastModified}`;
}

function mergeFiles(current: File[], incoming: File[]) {
  const map = new Map(current.map((file) => [fileKey(file), file]));
  for (const file of incoming) {
    map.set(fileKey(file), file);
  }
  return [...map.values()];
}

function UploadFileRow({ file }: { file: UploadFileState }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{file.file.name}</p>
          <p className="text-xs text-muted-foreground">
            {(file.file.size / (1024 * 1024)).toFixed(1)} MB • {file.status}
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
  const { batch, setBatch, updateFile, reset } = useUploadStore();
  const [isDragging, setIsDragging] = useState(false);
  const [templates, setTemplates] = useState<MissionTemplateDto[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const pendingRef = useRef<File[]>([]);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    pendingRef.current = pendingFiles;
  }, [pendingFiles]);

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

  const startUpload = useCallback(
    async (selected: File[]) => {
      if (selected.length === 0 || uploadingRef.current) return;

      if (selected.length > MAX_UPLOAD_BATCH_FILES) {
        setNotice(
          `Too many files (${selected.length}). Max ${MAX_UPLOAD_BATCH_FILES} per batch — upload in smaller groups.`,
        );
        return;
      }

      if (activeTemplate) {
        const basenames = new Set(
          selected.map((file) => parseBasename(file.name).basename),
        );
        const extensions = new Set(
          selected.map((file) =>
            parseBasename(file.name).extension.toLowerCase(),
          ),
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
              setBatch({
                batchId: undefined,
                files: [],
                status: "error",
                error: `Mission template requires SRT for each clip (missing for ${basename}).`,
              });
              return;
            }
          }
        }
        if (activeTemplate.requireLrf && !extensions.has("lrf")) {
          // optional soft notice — LRF often pairs with one clip in a batch
        }
        if (!checklistReady) {
          setBatch({
            batchId: undefined,
            files: [],
            status: "error",
            error: "Complete the mission checklist before uploading.",
          });
          return;
        }
      }

      uploadingRef.current = true;
      setNotice(null);

      const missingMap = detectMissingLinkedFiles(selected);
      const localFiles: UploadFileState[] = selected.map((file) => {
        const { basename, extension } = parseBasename(file.name);
        const missingLinked = missingMap.get(basename);
        return {
          localId: createClientId(),
          file,
          basename,
          extension,
          status: "queued",
          progress: 0,
          missingLinked,
        };
      });

      setBatch({ batchId: undefined, files: localFiles, status: "uploading" });

      try {
        // Always start a fresh batch for each staged wave so prior commits
        // cannot leave an invalid/closed batchId.
        const init = await initUploadBatch(selected);
        setBatch({
          batchId: init.batchId,
          status: "uploading",
          files: localFiles.map((local, index) => ({
            ...local,
            sessionId: init.files[index]?.id,
          })),
        });

        for (let i = 0; i < localFiles.length; i++) {
          const local = localFiles[i]!;
          const session = init.files[i]!;
          updateFile(local.localId, {
            status: "uploading",
            sessionId: session.id,
          });

          await uploadFileChunks({
            sessionId: session.id,
            file: local.file,
            chunkSizeBytes: session.chunkSizeBytes,
            totalChunks: session.totalChunks,
            onProgress: (progress) =>
              updateFile(local.localId, { progress, status: "uploading" }),
          });

          updateFile(local.localId, { progress: 1, status: "complete" });
        }

        setBatch({
          batchId: init.batchId,
          files: localFiles.map((f) => ({
            ...f,
            progress: 1,
            status: "complete",
          })),
          status: "committing",
        });

        const commitResult = (await commitUploadBatch(init.batchId)) as {
          warnings?: string[];
        };
        setBatch({
          batchId: init.batchId,
          files: localFiles.map((f) => ({
            ...f,
            progress: 1,
            status: "committed",
          })),
          status: "done",
        });
        if (commitResult.warnings && commitResult.warnings.length > 0) {
          setNotice(commitResult.warnings.join(" · "));
        }
      } catch (error) {
        setBatch({
          batchId: undefined,
          files: localFiles,
          status: "error",
          error: error instanceof Error ? error.message : "Upload failed",
        });
      } finally {
        uploadingRef.current = false;

        // Auto-continue with overflow / files dropped during this wave.
        const leftover = pendingRef.current;
        if (leftover.length > 0) {
          const wave = leftover.slice(0, MAX_UPLOAD_BATCH_FILES);
          const rest = leftover.slice(MAX_UPLOAD_BATCH_FILES);
          setPendingFiles(rest);
          pendingRef.current = rest;
          void startUpload(wave);
        }
      }
    },
    [activeTemplate, checklistReady, setBatch, updateFile],
  );

  const queueFiles = useCallback(
    (incoming: File[]) => {
      if (incoming.length === 0) return;

      setPendingFiles((current) => {
        const merged = mergeFiles(current, incoming);
        const added = merged.length - current.length;
        if (added > 0) {
          const waves = Math.ceil(merged.length / MAX_UPLOAD_BATCH_FILES);
          setNotice(
            uploadingRef.current
              ? `Added ${added} file${added === 1 ? "" : "s"} — they’ll upload after the current batch.`
              : waves > 1
                ? `Ready: ${merged.length} files (will upload in ${waves} batches of up to ${MAX_UPLOAD_BATCH_FILES}).`
                : `Ready: ${merged.length} file${merged.length === 1 ? "" : "s"}`,
          );
        }
        pendingRef.current = merged;
        return merged;
      });

      if (startTimerRef.current) clearTimeout(startTimerRef.current);

      // Short debounce so multiple drops can accumulate before upload starts.
      startTimerRef.current = setTimeout(() => {
        if (uploadingRef.current) return;
        const ready = pendingRef.current;
        if (ready.length === 0) return;
        const wave = ready.slice(0, MAX_UPLOAD_BATCH_FILES);
        const rest = ready.slice(MAX_UPLOAD_BATCH_FILES);
        setPendingFiles(rest);
        pendingRef.current = rest;
        void startUpload(wave);
      }, 700);
    },
    [startUpload],
  );

  useEffect(() => {
    return () => {
      if (startTimerRef.current) clearTimeout(startTimerRef.current);
    };
  }, []);

  const onInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const list = event.target.files ? [...event.target.files] : [];
    queueFiles(list);
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
    queueFiles(collected);
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
          basenames (video + SRT/LRF) and hyperlapse/panorama folders are grouped.
          Panoramas pair PANORAMA/100_XXXX tiles with 100MEDIA/DJI_XXXX.JPG when
          both are present — or when uploaded at different times (stitch first,
          tiles later).
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Limits: up to {MAX_UPLOAD_BATCH_FILES} files per batch · up to ~80 GB
          per file
        </p>
      </div>

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
        onQueueFiles={queueFiles}
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
                setNotice(null);
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
