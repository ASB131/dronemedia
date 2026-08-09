"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Film,
  ImageIcon,
  Pencil,
  Plane,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MediaGridSkeleton } from "@/components/ui/skeletons";
import type { DroneAssetDto, DroneDto } from "@/lib/drones/queries";

function formatHours(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0h";
  const hours = seconds / 3600;
  if (hours >= 10) return `${hours.toFixed(1)}h`;
  if (hours >= 1) return `${hours.toFixed(2)}h`;
  const minutes = seconds / 60;
  if (minutes >= 1) return `${minutes.toFixed(0)}m`;
  return `${Math.round(seconds)}s`;
}

function formatDistance(meters: number) {
  if (!Number.isFinite(meters) || meters <= 0) return "0 km";
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

function formatWhen(timestamp: string | null) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(timestamp));
}

function formatPanoBreakdown(drone: DroneDto) {
  const total = drone.pano180Count + drone.pano360Count;
  if (total === 0) return "0";
  const parts: string[] = [];
  if (drone.pano180Count > 0) parts.push(`${drone.pano180Count}×180°`);
  if (drone.pano360Count > 0) parts.push(`${drone.pano360Count}×360°`);
  return `${total} · ${parts.join(" · ")}`;
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight">
        {value}
      </p>
    </div>
  );
}

export function DronesPanel() {
  const [drones, setDrones] = useState<DroneDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assets, setAssets] = useState<DroneAssetDto[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editSerial, setEditSerial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const response = await fetch("/api/drones");
    if (!response.ok) {
      setError("Failed to load drones");
      setLoading(false);
      return;
    }
    const payload = (await response.json()) as { drones: DroneDto[] };
    setDrones(payload.drones);
    setLoading(false);
  }

  useEffect(() => {
    setLoading(true);
    void reload();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setAssets([]);
      return;
    }
    let mounted = true;
    setAssetsLoading(true);

    async function loadAssets() {
      const response = await fetch(
        `/api/drones/${encodeURIComponent(selectedId!)}/assets`,
      );
      if (!response.ok) {
        if (mounted) {
          setAssets([]);
          setAssetsLoading(false);
          setError("Failed to load drone media");
        }
        return;
      }
      const payload = (await response.json()) as { assets: DroneAssetDto[] };
      if (mounted) {
        setAssets(payload.assets);
        setAssetsLoading(false);
      }
    }

    void loadAssets();
    return () => {
      mounted = false;
    };
  }, [selectedId]);

  const selected = drones.find((drone) => drone.id === selectedId) ?? null;

  function startEdit(drone: DroneDto) {
    setEditing(true);
    setEditName(drone.name);
    setEditModel(drone.model ?? "");
    setEditSerial(drone.serialNumber ?? "");
  }

  async function createDrone(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const response = await fetch("/api/drones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        model: model.trim() || undefined,
        serialNumber: serialNumber.trim() || undefined,
      }),
    });
    setBusy(false);
    if (!response.ok) {
      setError("Failed to create drone");
      return;
    }
    setName("");
    setModel("");
    setSerialNumber("");
    setCreating(false);
    await reload();
  }

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !editName.trim()) return;
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/drones/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName.trim(),
        model: editModel.trim() ? editModel.trim() : null,
        serialNumber: editSerial.trim() ? editSerial.trim() : null,
      }),
    });
    setBusy(false);
    if (!response.ok) {
      setError("Failed to update drone");
      return;
    }
    setEditing(false);
    await reload();
  }

  async function removeDrone(droneId: string) {
    if (!confirm("Delete this drone? Media stays, but the link is cleared.")) {
      return;
    }
    setBusy(true);
    const response = await fetch(`/api/drones/${droneId}`, { method: "DELETE" });
    setBusy(false);
    if (!response.ok) {
      setError("Failed to delete drone");
      return;
    }
    if (selectedId === droneId) setSelectedId(null);
    await reload();
  }

  if (selected) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <button
            type="button"
            aria-label="Back to drones"
            className="inline-flex size-9 items-center justify-center rounded-full hover:bg-muted"
            onClick={() => {
              setSelectedId(null);
              setEditing(false);
              setError(null);
            }}
          >
            <ArrowLeft className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold tracking-tight">
              {selected.name}
            </h1>
            <p className="text-xs text-muted-foreground">
              {[selected.model, selected.serialNumber].filter(Boolean).join(" · ") ||
                "No model or serial"}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => (editing ? setEditing(false) : startEdit(selected))}
          >
            <Pencil className="size-3.5" />
            {editing ? "Cancel" : "Edit"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void removeDrone(selected.id)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-4">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Stats</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              <StatCard
                label="Flight time"
                value={formatHours(selected.flightDurationSeconds)}
              />
              <StatCard
                label="Distance"
                value={formatDistance(selected.totalDistanceMeters)}
              />
              <StatCard
                label="Max altitude"
                value={
                  selected.maxAltitudeMeters != null
                    ? `${Math.round(selected.maxAltitudeMeters)} m`
                    : "—"
                }
              />
              <StatCard
                label="Flights"
                value={String(selected.flightCount)}
              />
              <StatCard
                label="Photos"
                value={String(selected.photoCount)}
              />
              <StatCard
                label="Videos"
                value={String(selected.videoCount)}
              />
              <StatCard
                label="Panos"
                value={formatPanoBreakdown(selected)}
              />
              <StatCard
                label="Recording time"
                value={formatHours(selected.recordingDurationSeconds)}
              />
              <StatCard
                label="Last flown"
                value={formatWhen(selected.lastCapturedAt)}
              />
            </div>
          </section>

          {editing ? (
            <form
              onSubmit={(event) => void saveEdit(event)}
              className="space-y-3 rounded-2xl border border-border bg-muted/20 p-4"
            >
              <Input
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                placeholder="Name"
                required
              />
              <Input
                value={editModel}
                onChange={(event) => setEditModel(event.target.value)}
                placeholder="Model (optional)"
              />
              <Input
                value={editSerial}
                onChange={(event) => setEditSerial(event.target.value)}
                placeholder="Serial number (optional)"
              />
              <Button type="submit" size="sm" disabled={busy}>
                Save changes
              </Button>
            </form>
          ) : null}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">
              Media ({selected.assetCount})
            </h2>
            {assetsLoading ? (
              <MediaGridSkeleton count={12} className="p-0" />
            ) : assets.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
                <p className="text-sm text-muted-foreground">
                  No media linked to this drone yet.
                </p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Open an asset and choose this drone under Drone &amp; flight.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
                {assets.map((asset) => (
                  <Link
                    key={asset.id}
                    href={`/assets/${asset.id}`}
                    className="group relative aspect-square overflow-hidden rounded-md bg-muted"
                    title={asset.displayName}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/assets/${asset.id}/thumbnail`}
                      alt={asset.displayName}
                      className="size-full object-cover transition duration-200 group-hover:scale-[1.03]"
                    />
                    <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      {asset.assetType === "video" ? (
                        <Film className="size-3" />
                      ) : (
                        <ImageIcon className="size-3" />
                      )}
                      {asset.panoramaBadge ? (
                        <span>{asset.panoramaBadge}</span>
                      ) : null}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Drones</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Stats roll up from every photo, video, and flight linked to each
            aircraft
          </p>
        </div>
        <Button
          size="sm"
          variant={creating ? "outline" : "default"}
          onClick={() => setCreating((value) => !value)}
        >
          <Plus className="size-4" />
          {creating ? "Cancel" : "Add drone"}
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}

        {creating ? (
          <form
            onSubmit={(event) => void createDrone(event)}
            className="mb-6 space-y-3 rounded-2xl border border-border bg-muted/20 p-4 sm:max-w-md"
          >
            <Input
              placeholder="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              required
            />
            <Input
              placeholder="Model (optional)"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
            <Input
              placeholder="Serial number (optional)"
              value={serialNumber}
              onChange={(event) => setSerialNumber(event.target.value)}
            />
            <Button type="submit" disabled={busy}>
              Add drone
            </Button>
          </form>
        ) : null}

        {loading ? (
          <MediaGridSkeleton
            count={8}
            className="grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 [&_>div]:aspect-[4/3] [&_>div]:rounded-2xl"
          />
        ) : drones.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <Plane className="size-8 text-muted-foreground/70" />
            <p className="text-sm text-muted-foreground">
              Add your aircraft, then link media from the asset page.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {drones.map((drone) => (
              <button
                key={drone.id}
                type="button"
                onClick={() => setSelectedId(drone.id)}
                className="group overflow-hidden rounded-2xl border border-border bg-card text-left transition hover:border-primary/40 hover:shadow-sm"
              >
                <div className="relative aspect-[4/3] bg-muted">
                  {drone.coverAssetId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/assets/${drone.coverAssetId}/thumbnail`}
                      alt=""
                      className="size-full object-cover transition duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center">
                      <Plane className="size-10 text-muted-foreground/40" />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-3.5 pb-3 pt-12">
                    <p className="truncate text-base font-semibold text-white">
                      {drone.name}
                    </p>
                    <p className="mt-0.5 text-xs text-white/80">
                      {drone.model ? `${drone.model} · ` : ""}
                      {formatHours(drone.flightDurationSeconds)} flight
                      {drone.totalDistanceMeters > 0
                        ? ` · ${formatDistance(drone.totalDistanceMeters)}`
                        : ""}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-px border-t border-border bg-border">
                  <div className="bg-card px-2.5 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Media
                    </p>
                    <p className="text-sm font-semibold tabular-nums">
                      {drone.assetCount}
                    </p>
                  </div>
                  <div className="bg-card px-2.5 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Flights
                    </p>
                    <p className="text-sm font-semibold tabular-nums">
                      {drone.flightCount}
                    </p>
                  </div>
                  <div className="bg-card px-2.5 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Panos
                    </p>
                    <p className="text-sm font-semibold tabular-nums">
                      {drone.pano180Count + drone.pano360Count}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
