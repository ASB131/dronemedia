"use client";

import { parseCubeLut, type ParsedCubeLut } from "@/lib/luts/cube-parse";

const cache = new Map<string, ParsedCubeLut>();
const inflight = new Map<string, Promise<ParsedCubeLut>>();

export async function loadParsedLut(lutId: string): Promise<ParsedCubeLut> {
  const hit = cache.get(lutId);
  if (hit) return hit;

  const pending = inflight.get(lutId);
  if (pending) return pending;

  const promise = (async () => {
    const response = await fetch(`/api/luts/${lutId}/file`);
    if (!response.ok) {
      throw new Error("Failed to load LUT");
    }
    const text = await response.text();
    const parsed = parseCubeLut(text);
    cache.set(lutId, parsed);
    return parsed;
  })();

  inflight.set(lutId, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(lutId);
  }
}
