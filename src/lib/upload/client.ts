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

export async function uploadFileChunks(params: {
  sessionId: string;
  file: File;
  chunkSizeBytes: number;
  totalChunks: number;
  onProgress: (progress: number) => void;
}) {
  for (let index = 0; index < params.totalChunks; index++) {
    const start = index * params.chunkSizeBytes;
    const end = Math.min(start + params.chunkSizeBytes, params.file.size);
    const chunk = params.file.slice(start, end);

    const response = await fetch(
      `/api/upload/files/${params.sessionId}/chunks/${index}`,
      {
        method: "PUT",
        body: chunk,
      },
    );

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      throw new Error(payload.error ?? `Chunk ${index} upload failed`);
    }

    params.onProgress(end / params.file.size);
  }

  const completeResponse = await fetch(
    `/api/upload/files/${params.sessionId}/complete`,
    { method: "POST" },
  );

  if (!completeResponse.ok) {
    const payload = (await completeResponse.json()) as { error?: string };
    throw new Error(payload.error ?? "Failed to finalize file upload");
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

export function detectMissingLinkedFiles(files: File[]): Map<string, Array<"srt" | "lrf">> {
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
