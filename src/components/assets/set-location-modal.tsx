"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useMapTheme } from "@/hooks/use-map-theme";
import { basemapTileUrl } from "@/lib/map/tiles";

const DEFAULT_CENTER = { lat: 51.5, lng: -0.12 };

export function SetLocationModal({
  open,
  initial,
  saving,
  onClose,
  onSave,
  onClear,
}: {
  open: boolean;
  initial: { lat: number; lng: number } | null;
  saving: boolean;
  onClose: () => void;
  onSave: (point: { lat: number; lng: number }) => void;
  onClear: () => void;
}) {
  const mapTheme = useMapTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    marker: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    L: any;
  } | null>(null);
  const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(
    initial,
  );

  useEffect(() => {
    if (open) setDraft(initial);
  }, [open, initial]);

  useEffect(() => {
    if (!open || !containerRef.current) return;
    let disposed = false;

    void (async () => {
      await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (window as unknown as { L: any }).L;
      if (!L || disposed || !containerRef.current) return;

      const start = initial ?? DEFAULT_CENTER;
      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: false,
      }).setView([start.lat, start.lng], initial ? 16 : 6);

      L.tileLayer(basemapTileUrl(mapTheme), {
        attribution: "",
        maxZoom: 20,
      }).addTo(map);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pinOptions = {
        radius: 10,
        color: "#0ea5e9",
        weight: 2,
        fillColor: "#38bdf8",
        fillOpacity: 0.95,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let marker: any = null;
      if (initial) {
        marker = L.circleMarker([initial.lat, initial.lng], pinOptions).addTo(
          map,
        );
      }

      map.on("click", (event: { latlng: { lat: number; lng: number } }) => {
        const point = { lat: event.latlng.lat, lng: event.latlng.lng };
        setDraft(point);
        if (marker) {
          marker.setLatLng([point.lat, point.lng]);
        } else {
          marker = L.circleMarker(
            [point.lat, point.lng],
            pinOptions,
          ).addTo(map);
          mapRef.current = { map, marker, L };
        }
      });

      mapRef.current = { map, marker, L };
      window.requestAnimationFrame(() => {
        map.invalidateSize({ animate: false });
      });
    })();

    return () => {
      disposed = true;
      mapRef.current?.map.remove();
      mapRef.current = null;
    };
    // Recreate only when the modal opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Set location"
      onClick={onClose}
    >
      <div
        className="flex h-[min(92vh,860px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">
              {initial ? "Change location" : "Set location"}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Click the map to place the pin, then save.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
        <div ref={containerRef} className="min-h-0 flex-1 bg-muted" />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {draft
              ? `${draft.lat.toFixed(6)}, ${draft.lng.toFixed(6)}`
              : "No pin yet"}
          </p>
          <div className="flex flex-wrap gap-2">
            {initial ? (
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={onClear}
              >
                Clear location
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saving || !draft}
              onClick={() => {
                if (draft) onSave(draft);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
