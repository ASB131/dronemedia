import { getFileRelativePath } from "@/lib/upload/relative-path";

export type UploadFileState = {
  localId: string;
  sessionId?: string;
  file: File;
  basename: string;
  extension: string;
  status:
    | "queued"
    | "uploading"
    | "assembling"
    | "complete"
    | "error"
    | "committed";
  progress: number;
  error?: string;
  missingLinked?: Array<"srt" | "lrf">;
};

export type UploadBatchState = {
  batchId?: string;
  files: UploadFileState[];
  status: "idle" | "uploading" | "committing" | "done" | "error";
  error?: string;
};

export type ClientUploadInitResponse = {
  batchId: string;
  chunkSizeBytes: number;
  files: Array<{
    id: string;
    batchId: string;
    displayName: string;
    basename: string;
    extension: string;
    fileSizeBytes: number;
    chunkSizeBytes: number;
    totalChunks: number;
    uploadedChunkIndices: number[];
  }>;
};

const CHUNK_CONCURRENCY = 3;
const CHUNK_MAX_ATTEMPTS = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkByteRange(
  fileSize: number,
  chunkSizeBytes: number,
  index: number,
) {
  const start = index * chunkSizeBytes;
  const end = Math.min(start + chunkSizeBytes, fileSize);
  return { start, end, size: end - start };
}

function bytesForIndices(
  fileSize: number,
  chunkSizeBytes: number,
  indices: Iterable<number>,
) {
  let total = 0;
  for (const index of indices) {
    total += chunkByteRange(fileSize, chunkSizeBytes, index).size;
  }
  return total;
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index]!);
      }
    },
  );
  await Promise.all(runners);
}

export async function initUploadBatch(
  files: File[],
  batchId?: string,
): Promise<ClientUploadInitResponse> {
  const response = await fetch("/api/upload/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      batchId,
      files: files.map((file) => ({
        filename: file.name,
        sizeBytes: file.size,
        lastModifiedMs: file.lastModified,
        relativePath: getFileRelativePath(file),
      })),
    }),
  });

  if (!response.ok) {
    const payload = (await response.json()) as { error?: string };
    throw new Error(payload.error ?? "Failed to initialize upload");
  }

  return (await response.json()) as ClientUploadInitResponse;
}

async function putChunk(params: {
  sessionId: string;
  index: number;
  chunk: Blob;
  signal?: AbortSignal;
}) {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < CHUNK_MAX_ATTEMPTS; attempt++) {
    if (params.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    try {
      const response = await fetch(
        `/api/upload/files/${params.sessionId}/chunks/${params.index}`,
        {
          method: "PUT",
          body: params.chunk,
          signal: params.signal,
        },
      );
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `Chunk ${params.index} upload failed`);
      }
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      lastError =
        error instanceof Error ? error : new Error("Chunk upload failed");
      if (attempt < CHUNK_MAX_ATTEMPTS - 1) {
        await sleep(300 * (attempt + 1));
      }
    }
  }
  throw lastError ?? new Error(`Chunk ${params.index} upload failed`);
}

export async function uploadFileChunks(params: {
  sessionId: string;
  file: File;
  chunkSizeBytes: number;
  totalChunks: number;
  uploadedChunkIndices?: number[];
  signal?: AbortSignal;
  onProgress: (progress: number) => void;
  onAssembling?: () => void;
}) {
  const uploaded = new Set(params.uploadedChunkIndices ?? []);
  const missing: number[] = [];
  for (let index = 0; index < params.totalChunks; index++) {
    if (!uploaded.has(index)) missing.push(index);
  }

  const report = () => {
    const doneBytes = bytesForIndices(
      params.file.size,
      params.chunkSizeBytes,
      uploaded,
    );
    params.onProgress(
      params.file.size === 0 ? 1 : Math.min(1, doneBytes / params.file.size),
    );
  };
  report();

  await mapPool(missing, CHUNK_CONCURRENCY, async (index) => {
    if (params.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const { start, end } = chunkByteRange(
      params.file.size,
      params.chunkSizeBytes,
      index,
    );
    const chunk = params.file.slice(start, end);
    await putChunk({
      sessionId: params.sessionId,
      index,
      chunk,
      signal: params.signal,
    });
    uploaded.add(index);
    report();
  });

  params.onAssembling?.();

  const completeResponse = await fetch(
    `/api/upload/files/${params.sessionId}/complete`,
    { method: "POST", signal: params.signal },
  );

  if (!completeResponse.ok) {
    const payload = (await completeResponse.json()) as { error?: string };
    throw new Error(payload.error ?? "Failed to finalize file upload");
  }
}

export async function markUploadFileFailed(
  sessionId: string,
  errorMessage: string,
) {
  try {
    await fetch(`/api/upload/files/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "failed", errorMessage }),
    });
  } catch {
    // Best-effort; commit will also skip non-complete sessions.
  }
}

export async function commitUploadBatch(batchId: string) {
  const response = await fetch(`/api/upload/batch/${batchId}/commit`, {
    method: "POST",
  });
  if (!response.ok) {
    const payload = (await response.json()) as { error?: string };
    throw new Error(payload.error ?? "Failed to commit batch");
  }
  return response.json();
}

export function parseBasename(filename: string): {
  basename: string;
  extension: string;
} {
  const parts = filename.split(".");
  const extension = parts.length > 1 ? (parts.pop()?.toLowerCase() ?? "") : "";
  const basename = parts.join(".");
  return { basename: basename.toLowerCase(), extension };
}

export function detectMissingLinkedFiles(
  files: File[],
): Map<string, Array<"srt" | "lrf">> {
  const groups = new Map<
    string,
    { hasVideo: boolean; hasSrt: boolean; hasLrf: boolean }
  >();

  for (const file of files) {
    const { basename, extension } = parseBasename(file.name);
    const group = groups.get(basename) ?? {
      hasVideo: false,
      hasSrt: false,
      hasLrf: false,
    };
    if (["mp4", "mov", "mkv", "m4v"].includes(extension)) group.hasVideo = true;
    if (extension === "srt") group.hasSrt = true;
    if (extension === "lrf") group.hasLrf = true;
    groups.set(basename, group);
  }

  const missing = new Map<string, Array<"srt" | "lrf">>();
  for (const [basename, group] of groups) {
    if (!group.hasVideo) continue;
    const needs: Array<"srt" | "lrf"> = [];
    if (!group.hasSrt) needs.push("srt");
    if (!group.hasLrf) needs.push("lrf");
    if (needs.length > 0) missing.set(basename, needs);
  }
  return missing;
}

export function formatUploadBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatEtaSeconds(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}
