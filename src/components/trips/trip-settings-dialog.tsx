"use client";

import { useEffect, useState } from "react";
import { ImagePlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TimelineAssetDto } from "@/lib/assets/timeline";
import { assetThumbnailSrc } from "@/lib/assets/thumbnail-url";
import type { TripSummaryDto } from "@/lib/trips/types";

export function TripSettingsDialog({
  trip,
  open,
  onClose,
  onSaved,
}: {
  trip: TripSummaryDto | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [coverAssetId, setCoverAssetId] = useState<string | null>(null);
  const [pickerAssets, setPickerAssets] = useState<TimelineAssetDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !trip) return;
    setName(trip.name);
    setStartDate(trip.startDate);
    setEndDate(trip.endDate);
    setCoverAssetId(trip.coverAssetId);
    setPreviewUrl(trip.coverThumbnailUrl);
    setError(null);
    void (async () => {
      const response = await fetch(
        `/api/trips/${trip.id}/timeline?limit=48`,
      );
      if (!response.ok) return;
      const payload = (await response.json()) as {
        sections: Array<{ assets: TimelineAssetDto[] }>;
      };
      const assets = payload.sections.flatMap((s) => s.assets);
      setPickerAssets(assets);
    })();
  }, [open, trip]);

  if (!open || !trip) return null;

  const tripId = trip.id;

  async function saveBasics() {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/trips/${tripId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        startDate,
        endDate,
        coverAssetId,
      }),
    });
    setBusy(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(body?.error ?? "Failed to save");
      return;
    }
    const payload = (await response.json()) as {
      trip: TripSummaryDto;
    };
    setPreviewUrl(payload.trip.coverThumbnailUrl);
    await onSaved();
    onClose();
  }

  async function uploadCover(file: File) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    const response = await fetch(`/api/trips/${tripId}/cover`, {
      method: "POST",
      body: form,
    });
    setBusy(false);
    if (!response.ok) {
      setError("Failed to upload cover");
      return;
    }
    const payload = (await response.json()) as {
      coverThumbnailUrl: string;
    };
    setPreviewUrl(payload.coverThumbnailUrl);
    setCoverAssetId(null);
    await onSaved();
  }

  async function clearCustomCover() {
    if (!trip!.hasCustomCover) return;
    setBusy(true);
    const response = await fetch(`/api/trips/${tripId}/cover`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!response.ok) return;
    const payload = (await response.json()) as { trip: TripSummaryDto };
    setPreviewUrl(payload.trip.coverThumbnailUrl);
    await onSaved();
  }

  return (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal
        aria-labelledby="trip-settings-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-background shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="trip-settings-title" className="text-sm font-semibold">
            Trip settings
          </h2>
          <button
            type="button"
            aria-label="Close"
            className="rounded-md p-1 hover:bg-muted"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              Start
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              End
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
              />
            </label>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Cover</p>
            <div className="flex gap-3">
              <div className="h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-muted">
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
                    None
                  </div>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-primary">
                  <ImagePlus className="size-3.5" />
                  Upload photo
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadCover(file);
                      e.target.value = "";
                    }}
                  />
                </label>
                {trip!.hasCustomCover ? (
                  <button
                    type="button"
                    className="text-left text-xs text-muted-foreground underline"
                    onClick={() => void clearCustomCover()}
                  >
                    Remove uploaded cover
                  </button>
                ) : null}
              </div>
            </div>
            {pickerAssets.length > 0 ? (
              <div className="grid grid-cols-6 gap-1.5">
                {pickerAssets.map((asset) => {
                  const selected = coverAssetId === asset.id;
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      className={`aspect-square overflow-hidden rounded-md border-2 ${
                        selected ? "border-primary" : "border-transparent"
                      }`}
                      onClick={() => {
                        setCoverAssetId(asset.id);
                        setPreviewUrl(assetThumbnailSrc(asset.id));
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={assetThumbnailSrc(asset.id)}
                        alt=""
                        className="size-full object-cover"
                      />
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No media in this date range yet — upload a cover or widen dates
                after save.
              </p>
            )}
          </div>

          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || !name.trim()}
              onClick={() => void saveBasics()}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}