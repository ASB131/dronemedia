"use client";

import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_PLAYBACK_RESOLUTION,
  isPlaybackResolution,
  type PlaybackResolution,
} from "@/lib/playback/resolution";

export type PlaybackPreferences = {
  defaultPlaybackResolution: PlaybackResolution;
  previewLutId: string | null;
};

const defaults: PlaybackPreferences = {
  defaultPlaybackResolution: DEFAULT_PLAYBACK_RESOLUTION,
  previewLutId: null,
};

/**
 * Account-level preview prefs (resolution + LUT) shared across asset, map,
 * community, and flight players.
 */
export function usePlaybackPreferences() {
  const [prefs, setPrefs] = useState<PlaybackPreferences>(defaults);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/account");
        if (!response.ok) return;
        const payload = (await response.json()) as {
          preferences?: {
            defaultPlaybackResolution?: string;
            previewLutId?: string | null;
          };
        };
        if (cancelled) return;
        const resolution = payload.preferences?.defaultPlaybackResolution;
        setPrefs({
          defaultPlaybackResolution: isPlaybackResolution(resolution)
            ? resolution
            : DEFAULT_PLAYBACK_RESOLUTION,
          previewLutId: payload.preferences?.previewLutId ?? null,
        });
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreviewLutId = useCallback(async (lutId: string | null) => {
    setPrefs((current) => ({ ...current, previewLutId: lutId }));
    await fetch("/api/account/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previewLutId: lutId }),
    });
  }, []);

  const setDefaultPlaybackResolution = useCallback(
    async (resolution: PlaybackResolution) => {
      setPrefs((current) => ({
        ...current,
        defaultPlaybackResolution: resolution,
      }));
      await fetch("/api/account/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultPlaybackResolution: resolution }),
      });
    },
    [],
  );

  return {
    ...prefs,
    ready,
    setPreviewLutId,
    setDefaultPlaybackResolution,
  };
}

/**
 * Viewer-chosen LUT for community/public grading only.
 * Null means explicitly none — do not fall back to the owner's preferred LUT.
 */
export function resolveViewerPreviewLutId(
  colorMode: string | null | undefined,
  previewLutId: string | null | undefined,
): string | null {
  if (!colorMode) return null;
  return previewLutId ?? null;
}
