"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  LUT_COLOR_PROFILES,
  lutColorProfileLabel,
  type LutColorProfile,
} from "@/lib/luts/color-profile";

type LutRow = {
  id: string;
  name: string;
  colorProfile: LutColorProfile;
  sizeBytes: number;
  createdAt: string;
  createdBy: string | null;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AdminLutsPanel() {
  const [luts, setLuts] = useState<LutRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [colorProfile, setColorProfile] = useState<LutColorProfile>("d_log");
  const fileRef = useRef<HTMLInputElement>(null);

  async function reload() {
    const response = await fetch("/api/admin/luts");
    if (!response.ok) {
      setError("Failed to load LUTs");
      return;
    }
    const payload = (await response.json()) as { luts: LutRow[] };
    setLuts(payload.luts);
  }

  useEffect(() => {
    let mounted = true;
    async function load() {
      const response = await fetch("/api/admin/luts");
      if (!response.ok) {
        if (mounted) setError("Failed to load LUTs");
        return;
      }
      const payload = (await response.json()) as { luts: LutRow[] };
      if (mounted) setLuts(payload.luts);
    }
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  async function uploadFile(file: File) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("colorProfile", colorProfile);
    if (name.trim()) form.set("name", name.trim());
    const response = await fetch("/api/admin/luts", {
      method: "POST",
      body: form,
    });
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(payload?.error ?? "Failed to upload LUT");
      return;
    }
    setName("");
    await reload();
  }

  async function setProfile(lutId: string, next: LutColorProfile) {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/admin/luts/${lutId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ colorProfile: next }),
    });
    setBusy(false);
    if (!response.ok) {
      setError("Failed to update LUT profile");
      return;
    }
    await reload();
  }

  async function remove(lutId: string) {
    if (!window.confirm("Delete this LUT? Assets using it will fall back to None.")) {
      return;
    }
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/admin/luts/${lutId}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!response.ok) {
      setError("Failed to delete LUT");
      return;
    }
    await reload();
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Preview LUTs</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Upload 3D <code className="text-[11px]">.cube</code> files for
          D-Log / D-Log M video grading (web preview + optional full-res
          download).
        </p>
      </div>

      <div className="space-y-3 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-[12rem] flex-1 text-xs text-muted-foreground">
            Display name (optional)
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 block w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
              placeholder="D-Log to Rec.709"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Color profile
            <select
              value={colorProfile}
              onChange={(event) =>
                setColorProfile(event.target.value as LutColorProfile)
              }
              className="mt-1 block rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
            >
              {LUT_COLOR_PROFILES.map((profile) => (
                <option key={profile} value={profile}>
                  {lutColorProfileLabel(profile)}
                </option>
              ))}
            </select>
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".cube,text/plain"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadFile(file);
            }}
          />
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setError(null);
              fileRef.current?.click();
            }}
          >
            <Upload className="size-4" />
            {busy ? "Uploading…" : "Upload .cube"}
          </Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>

      {luts.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">No LUTs yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {luts.map((lut) => (
            <li
              key={lut.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <div>
                <p className="font-medium">{lut.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(lut.sizeBytes)} ·{" "}
                  {new Date(lut.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={lut.colorProfile}
                  disabled={busy}
                  onChange={(event) =>
                    void setProfile(
                      lut.id,
                      event.target.value as LutColorProfile,
                    )
                  }
                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                  aria-label={`Color profile for ${lut.name}`}
                >
                  {LUT_COLOR_PROFILES.map((profile) => (
                    <option key={profile} value={profile}>
                      {lutColorProfileLabel(profile)}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void remove(lut.id)}
                >
                  <Trash2 className="size-4" />
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
