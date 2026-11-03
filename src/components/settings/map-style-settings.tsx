"use client";

import { useEffect, useState } from "react";

import { invalidateBasemapCache } from "@/hooks/use-basemap";
import { cn } from "@/lib/utils";

type StyleOption = {
  id: string;
  label: string;
  description: string;
  previewUrl: string | null;
};

export function MapStyleSettings({
  selectedStyleId,
  onSelect,
}: {
  selectedStyleId: string;
  onSelect: (styleId: string) => void | Promise<void>;
}) {
  const [styles, setStyles] = useState<StyleOption[]>([]);
  const [maptilerConfigured, setMaptilerConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [previewFailed, setPreviewFailed] = useState<Record<string, boolean>>(
    {},
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/map/styles");
        if (!response.ok) return;
        const payload = (await response.json()) as {
          styles: StyleOption[];
          maptilerConfigured: boolean;
        };
        if (!cancelled) {
          setStyles(payload.styles);
          setMaptilerConfigured(payload.maptilerConfigured);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">Loading map styles…</p>
    );
  }

  return (
    <div className="space-y-3">
      {!maptilerConfigured ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          MapTiler is not configured on the server — only OpenStreetMap is
          available until you set{" "}
          <code className="text-[11px]">map.provider: maptiler</code> and an API
          key in config.yml.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {styles.map((style) => {
          const selected = selectedStyleId === style.id;
          return (
            <button
              key={style.id}
              type="button"
              onClick={() => {
                void (async () => {
                  await onSelect(style.id);
                  invalidateBasemapCache();
                  window.dispatchEvent(
                    new CustomEvent("dm-preferences", {
                      detail: { mapStyleId: style.id },
                    }),
                  );
                })();
              }}
              className={cn(
                "overflow-hidden rounded-xl border text-left transition",
                selected
                  ? "border-primary ring-2 ring-primary/30"
                  : "border-border hover:border-primary/40",
              )}
            >
              <div className="relative aspect-[12/7] w-full bg-muted">
                {style.previewUrl && !previewFailed[style.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={style.previewUrl}
                    alt=""
                    className="size-full object-cover"
                    loading="lazy"
                    onError={() =>
                      setPreviewFailed((prev) => ({
                        ...prev,
                        [style.id]: true,
                      }))
                    }
                  />
                ) : (
                  <div className="flex size-full flex-col items-center justify-center gap-1 px-3 text-center text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/80">
                      {style.label}
                    </span>
                    {style.previewUrl && previewFailed[style.id]
                      ? "Preview unavailable"
                      : "OSM preview"}
                  </div>
                )}
                {selected ? (
                  <span className="absolute right-2 top-2 rounded-md bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    Selected
                  </span>
                ) : null}
              </div>
              <div className="px-3 py-2">
                <p className="text-sm font-medium">{style.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {style.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
