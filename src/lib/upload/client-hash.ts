"use client";

import XXH from "xxhashjs";

const CHUNK_SIZE = 1024 * 1024; // 1 MB

/**
 * Compute xxhash64 hex digest of a File/Blob in the browser
 * (matches server `computeXxhash` / xxhashjs h64).
 */
export async function xxhashFile(
  file: Blob,
  options?: {
    signal?: AbortSignal;
    onProgress?: (ratio: number) => void;
  },
): Promise<string> {
  const hasher = XXH.h64(0);
  let offset = 0;
  const total = file.size || 1;

  while (offset < file.size) {
    if (options?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const chunk = file.slice(offset, end);
    const buffer = await chunk.arrayBuffer();
    hasher.update(buffer);
    offset = end;
    options?.onProgress?.(offset / total);
  }

  return hasher.digest().toString(16).padStart(16, "0");
}

export type DuplicateLookupRequest = {
  digests?: string[];
  soft?: Array<{
    key: string;
    basename: string;
    sizeBytes: number;
  }>;
};

export type DuplicateHashMatch = {
  digest: string;
  assetId: string;
  displayName: string;
};

export type DuplicateSoftMatch = {
  key: string;
  assetId: string;
  displayName: string;
};

export type DuplicateLookupResponse = {
  hashMatches: DuplicateHashMatch[];
  softMatches: DuplicateSoftMatch[];
};

export async function lookupDuplicates(
  body: DuplicateLookupRequest,
): Promise<DuplicateLookupResponse> {
  const response = await fetch("/api/upload/duplicates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? "Duplicate lookup failed");
  }
  return response.json() as Promise<DuplicateLookupResponse>;
}
