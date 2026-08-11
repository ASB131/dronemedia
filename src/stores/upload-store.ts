import { create } from "zustand";

import { createClientId } from "@/lib/id";
import {
  commitUploadBatch,
  detectMissingLinkedFiles,
  initUploadBatch,
  markUploadFileFailed,
  parseBasename,
  uploadFileChunks,
  type UploadBatchState,
  type UploadFileState,
} from "@/lib/upload/client";
import { getFileRelativePath } from "@/lib/upload/relative-path";
import { MAX_UPLOAD_BATCH_FILES } from "@/lib/upload/validators";

export type UploadStats = {
  bytesUploaded: number;
  bytesTotal: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
};

export type UploadWaveInfo = {
  waveNumber: number;
  pendingCount: number;
};

type UploadStore = {
  batch: UploadBatchState;
  pendingFiles: File[];
  stats: UploadStats;
  dockExpanded: boolean;
  dockDismissed: boolean;
  bulkMode: boolean;
  softPaused: boolean;
  notice: string | null;
  waveInfo: UploadWaveInfo | null;
  setDockExpanded: (expanded: boolean) => void;
  setDockDismissed: (dismissed: boolean) => void;
  setBulkMode: (bulkMode: boolean) => void;
  setNotice: (notice: string | null) => void;
  setSoftPaused: (paused: boolean) => void;
  queueFiles: (incoming: File[]) => void;
  clearCompleted: () => void;
  reset: () => void;
  cancelActive: () => void;
};

const initialBatch: UploadBatchState = {
  files: [],
  status: "idle",
};

const initialStats: UploadStats = {
  bytesUploaded: 0,
  bytesTotal: 0,
  bytesPerSecond: 0,
  etaSeconds: null,
};

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

let uploading = false;
let waveAbortController: AbortController | null = null;
let fileAbortController: AbortController | null = null;
let startTimer: ReturnType<typeof setTimeout> | null = null;
let waveNumber = 0;
let speedSamples: Array<{ t: number; bytes: number }> = [];
let stopWaves = false;

function recomputeStats(files: UploadFileState[]): UploadStats {
  const bytesTotal = files.reduce((sum, file) => sum + file.file.size, 0);
  const bytesUploaded = files.reduce(
    (sum, file) => sum + file.file.size * Math.min(1, Math.max(0, file.progress)),
    0,
  );
  const now = Date.now();
  speedSamples.push({ t: now, bytes: bytesUploaded });
  speedSamples = speedSamples.filter((sample) => now - sample.t <= 5000);
  const oldest = speedSamples[0];
  const newest = speedSamples[speedSamples.length - 1];
  let bytesPerSecond = 0;
  if (oldest && newest && newest.t > oldest.t) {
    bytesPerSecond = Math.max(
      0,
      ((newest.bytes - oldest.bytes) / (newest.t - oldest.t)) * 1000,
    );
  }
  const remaining = Math.max(0, bytesTotal - bytesUploaded);
  const etaSeconds =
    bytesPerSecond > 1024 ? remaining / bytesPerSecond : null;
  return { bytesUploaded, bytesTotal, bytesPerSecond, etaSeconds };
}

async function runWave(files: File[]) {
  if (files.length === 0 || uploading) return;

  const store = useUploadStore.getState();
  if (store.softPaused || stopWaves) return;

  uploading = true;
  waveAbortController = new AbortController();
  const waveSignal = waveAbortController.signal;
  waveNumber += 1;
  speedSamples = [];

  const missingMap = detectMissingLinkedFiles(files);
  const localFiles: UploadFileState[] = files.map((file) => {
    const { basename, extension } = parseBasename(file.name);
    return {
      localId: createClientId(),
      file,
      basename,
      extension,
      status: "queued",
      progress: 0,
      missingLinked: missingMap.get(basename),
    };
  });

  useUploadStore.setState({
    batch: { batchId: undefined, files: localFiles, status: "uploading" },
    stats: recomputeStats(localFiles),
    dockDismissed: false,
    dockExpanded: true,
    waveInfo: {
      waveNumber,
      pendingCount: useUploadStore.getState().pendingFiles.length,
    },
    notice: null,
  });

  let batchId: string | undefined;
  let successCount = 0;
  let errorCount = 0;

  try {
    const init = await initUploadBatch(files);
    batchId = init.batchId;
    const withSessions = localFiles.map((local, index) => ({
      ...local,
      sessionId: init.files[index]?.id,
    }));
    useUploadStore.setState({
      batch: {
        batchId: init.batchId,
        status: "uploading",
        files: withSessions,
      },
      stats: recomputeStats(withSessions),
    });

    for (let i = 0; i < withSessions.length; i++) {
      if (waveSignal.aborted || stopWaves || useUploadStore.getState().softPaused) {
        if (!stopWaves && !waveSignal.aborted) {
          const leftover = withSessions.slice(i).map((entry) => entry.file);
          if (leftover.length > 0) {
            useUploadStore.setState((state) => ({
              pendingFiles: [...leftover, ...state.pendingFiles],
            }));
          }
        }
        break;
      }

      const local = withSessions[i]!;
      const session = init.files[i]!;
      fileAbortController = new AbortController();
      const fileSignal = fileAbortController.signal;

      patchFile(local.localId, {
        status: "uploading",
        sessionId: session.id,
        error: undefined,
      });

      try {
        await uploadFileChunks({
          sessionId: session.id,
          file: local.file,
          chunkSizeBytes: session.chunkSizeBytes,
          totalChunks: session.totalChunks,
          uploadedChunkIndices: session.uploadedChunkIndices,
          signal: fileSignal,
          onProgress: (progress) =>
            patchFile(local.localId, { progress, status: "uploading" }),
          onAssembling: () =>
            patchFile(local.localId, { status: "assembling", progress: 1 }),
        });
        patchFile(local.localId, { progress: 1, status: "complete" });
        successCount += 1;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          patchFile(local.localId, {
            status: "error",
            error: "Cancelled",
          });
          errorCount += 1;
          if (session.id) {
            void markUploadFileFailed(session.id, "Cancelled");
          }
          // Cancel-current only; continue with remaining files unless wave stop.
          if (waveSignal.aborted || stopWaves) break;
          continue;
        }
        const message =
          error instanceof Error ? error.message : "Upload failed";
        patchFile(local.localId, { status: "error", error: message });
        errorCount += 1;
        if (session.id) {
          void markUploadFileFailed(session.id, message);
        }
      } finally {
        fileAbortController = null;
      }
    }

    const latest = useUploadStore.getState().batch.files;
    const completed = latest.filter((file) => file.status === "complete");

    if (completed.length > 0 && batchId && !stopWaves) {
      useUploadStore.setState((state) => ({
        batch: { ...state.batch, batchId, status: "committing" },
      }));
      try {
        const commitResult = (await commitUploadBatch(batchId)) as {
          warnings?: string[];
        };
        useUploadStore.setState((state) => ({
          batch: {
            ...state.batch,
            batchId,
            status: errorCount > 0 && successCount === 0 ? "error" : "done",
            error:
              errorCount > 0
                ? `${errorCount} file${errorCount === 1 ? "" : "s"} failed`
                : undefined,
            files: state.batch.files.map((file) =>
              file.status === "complete"
                ? { ...file, status: "committed" as const }
                : file,
            ),
          },
          notice:
            commitResult.warnings && commitResult.warnings.length > 0
              ? commitResult.warnings.join(" · ")
              : state.notice,
        }));
      } catch (error) {
        useUploadStore.setState((state) => ({
          batch: {
            ...state.batch,
            status: "error",
            error:
              error instanceof Error ? error.message : "Failed to commit batch",
          },
        }));
      }
    } else if (successCount === 0) {
      useUploadStore.setState((state) => ({
        batch: {
          ...state.batch,
          status: "error",
          error:
            state.batch.error ??
            (stopWaves || waveSignal.aborted
              ? "Upload cancelled"
              : "Upload failed"),
        },
      }));
    }
  } catch (error) {
    useUploadStore.setState((state) => ({
      batch: {
        ...state.batch,
        status: "error",
        error: error instanceof Error ? error.message : "Upload failed",
      },
    }));
  } finally {
    uploading = false;
    waveAbortController = null;
    fileAbortController = null;
    const nextState = useUploadStore.getState();
    useUploadStore.setState({
      waveInfo:
        nextState.pendingFiles.length > 0
          ? {
              waveNumber,
              pendingCount: nextState.pendingFiles.length,
            }
          : nextState.waveInfo,
    });

    if (
      !stopWaves &&
      !nextState.softPaused &&
      nextState.pendingFiles.length > 0
    ) {
      scheduleStart(0);
    }
  }
}

function patchFile(localId: string, patch: Partial<UploadFileState>) {
  useUploadStore.setState((state) => {
    const files = state.batch.files.map((file) =>
      file.localId === localId ? { ...file, ...patch } : file,
    );
    return {
      batch: { ...state.batch, files },
      stats: recomputeStats(files),
      waveInfo: state.waveInfo
        ? {
            ...state.waveInfo,
            pendingCount: state.pendingFiles.length,
          }
        : state.waveInfo,
    };
  });
}

function takeNextWave(): File[] {
  const pending = useUploadStore.getState().pendingFiles;
  if (pending.length === 0) return [];
  const wave = pending.slice(0, MAX_UPLOAD_BATCH_FILES);
  const rest = pending.slice(MAX_UPLOAD_BATCH_FILES);
  useUploadStore.setState({
    pendingFiles: rest,
    waveInfo: {
      waveNumber: waveNumber + (uploading ? 0 : 1),
      pendingCount: rest.length,
    },
  });
  return wave;
}

function scheduleStart(delayMs: number) {
  if (startTimer) clearTimeout(startTimer);
  startTimer = setTimeout(() => {
    startTimer = null;
    if (uploading || useUploadStore.getState().softPaused) return;
    const wave = takeNextWave();
    if (wave.length === 0) return;
    void runWave(wave);
  }, delayMs);
}

export const useUploadStore = create<UploadStore>((set, get) => ({
  batch: initialBatch,
  pendingFiles: [],
  stats: initialStats,
  dockExpanded: true,
  dockDismissed: true,
  bulkMode: false,
  softPaused: false,
  notice: null,
  waveInfo: null,
  setDockExpanded: (expanded) => set({ dockExpanded: expanded }),
  setDockDismissed: (dismissed) => set({ dockDismissed: dismissed }),
  setBulkMode: (bulkMode) => set({ bulkMode }),
  setNotice: (notice) => set({ notice }),
  setSoftPaused: (paused) => {
    set({ softPaused: paused });
    if (!paused) {
      scheduleStart(0);
    }
  },
  queueFiles: (incoming) => {
    if (incoming.length === 0) return;
    stopWaves = false;
    const current = get().pendingFiles;
    const merged = mergeFiles(current, incoming);
    const added = merged.length - current.length;
    const waves = Math.ceil(merged.length / MAX_UPLOAD_BATCH_FILES);
    const bulkHint = get().bulkMode
      ? " Bulk mode: long imports can take a while — keep this tab open. Admins can pause heavy processing jobs in Utilities during large imports."
      : "";

    let notice: string | null = get().notice;
    if (added > 0) {
      notice = uploading
        ? `Added ${added} file${added === 1 ? "" : "s"} — they’ll upload after the current batch.${bulkHint}`
        : waves > 1
          ? `Ready: ${merged.length} files (will upload in ${waves} batches of up to ${MAX_UPLOAD_BATCH_FILES}).${bulkHint}`
          : `Ready: ${merged.length} file${merged.length === 1 ? "" : "s"}.${bulkHint}`;
    }

    set({
      pendingFiles: merged,
      notice,
      dockDismissed: false,
      dockExpanded: true,
      waveInfo: {
        waveNumber: Math.max(1, waveNumber),
        pendingCount: merged.length,
      },
    });

    scheduleStart(700);
  },
  clearCompleted: () => {
    set((state) => {
      const active = state.batch.files.filter(
        (file) =>
          file.status === "queued" ||
          file.status === "uploading" ||
          file.status === "assembling",
      );
      if (active.length > 0) {
        return {
          batch: { ...state.batch, files: active },
          stats: recomputeStats(active),
        };
      }
      return {
        batch: initialBatch,
        stats: initialStats,
        notice: null,
        waveInfo: null,
        dockDismissed: true,
      };
    });
  },
  reset: () => {
    if (startTimer) {
      clearTimeout(startTimer);
      startTimer = null;
    }
    stopWaves = true;
    fileAbortController?.abort();
    waveAbortController?.abort();
    fileAbortController = null;
    waveAbortController = null;
    uploading = false;
    waveNumber = 0;
    speedSamples = [];
    set({
      batch: initialBatch,
      pendingFiles: [],
      stats: initialStats,
      notice: null,
      waveInfo: null,
      softPaused: false,
      dockDismissed: true,
    });
  },
  cancelActive: () => {
    fileAbortController?.abort();
  },
}));

export function isUploadActive(status: UploadBatchState["status"]) {
  return status === "uploading" || status === "committing";
}

export function hasActiveUploadFiles(files: UploadFileState[]) {
  return files.some(
    (file) =>
      file.status === "queued" ||
      file.status === "uploading" ||
      file.status === "assembling",
  );
}
