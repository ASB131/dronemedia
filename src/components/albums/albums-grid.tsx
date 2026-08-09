"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FolderPlus, Images, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MediaGridSkeleton } from "@/components/ui/skeletons";
import type { AlbumSummaryDto } from "@/lib/albums/queries";

export function AlbumsGrid() {
  const [albums, setAlbums] = useState<AlbumSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function reload() {
    const response = await fetch("/api/albums");
    if (!response.ok) {
      setError("Failed to load albums");
      return;
    }
    const payload = (await response.json()) as { albums: AlbumSummaryDto[] };
    setAlbums(payload.albums);
  }

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      const response = await fetch("/api/albums");
      if (!response.ok) {
        if (mounted) {
          setError("Failed to load albums");
          setLoading(false);
        }
        return;
      }
      const payload = (await response.json()) as { albums: AlbumSummaryDto[] };
      if (mounted) {
        setAlbums(payload.albums);
        setError(null);
        setLoading(false);
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  async function createAlbum(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const response = await fetch("/api/albums", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    setBusy(false);
    if (!response.ok) {
      setError("Failed to create album");
      return;
    }
    setName("");
    setCreating(false);
    await reload();
  }

  async function deleteAlbum(album: AlbumSummaryDto) {
    if (
      !confirm(
        `Delete album “${album.name}”? Media inside stays in your library.`,
      )
    ) {
      return;
    }
    setDeletingId(album.id);
    setError(null);
    const response = await fetch(`/api/albums/${album.id}`, {
      method: "DELETE",
    });
    setDeletingId(null);
    if (!response.ok) {
      setError("Failed to delete album");
      return;
    }
    await reload();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Albums</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : `${albums.length} album${albums.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <Button
          size="sm"
          variant={creating ? "outline" : "default"}
          onClick={() => setCreating((value) => !value)}
        >
          <FolderPlus className="size-4" />
          {creating ? "Cancel" : "New album"}
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}

        {creating ? (
          <form
            onSubmit={(event) => void createAlbum(event)}
            className="mb-5 flex flex-wrap gap-2 rounded-xl border border-border bg-muted/20 p-3"
          >
            <Input
              placeholder="Album name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="max-w-xs"
              autoFocus
            />
            <Button type="submit" size="sm" disabled={busy}>
              Create
            </Button>
          </form>
        ) : null}

        {loading ? (
          <MediaGridSkeleton count={18} />
        ) : albums.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <Images className="size-6 text-muted-foreground/70" />
            <p className="text-sm text-muted-foreground">
              No albums yet. Create one to group flights and stills.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
            {albums.map((album) => (
              <div key={album.id} className="group relative">
                <Link
                  href={`/albums/${album.id}`}
                  className="block overflow-hidden rounded-xl border border-border bg-card transition hover:border-foreground/25"
                >
                  <div className="relative aspect-square bg-muted">
                    {album.coverAssetId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/assets/${album.coverAssetId}/thumbnail`}
                        alt=""
                        className="size-full object-cover transition duration-300 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center">
                        <Images className="size-5 text-muted-foreground/45" />
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-2 pb-2 pt-8">
                      <p className="truncate text-xs font-semibold text-white">
                        {album.name}
                      </p>
                      <p className="truncate text-[10px] text-white/80">
                        {album.assetCount} item
                        {album.assetCount === 1 ? "" : "s"}
                        {album.role !== "owner"
                          ? ` · ${album.role}`
                          : null}
                      </p>
                    </div>
                  </div>
                </Link>
                {album.role === "owner" ? (
                  <button
                    type="button"
                    aria-label={`Delete ${album.name}`}
                    title="Delete album"
                    disabled={deletingId === album.id}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void deleteAlbum(album);
                    }}
                    className="absolute right-1.5 top-1.5 inline-flex size-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur transition hover:bg-black/75 group-hover:opacity-100 disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
