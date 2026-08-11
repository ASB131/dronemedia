"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Film,
  ImageIcon,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { AlbumMembersPanel } from "@/components/albums/album-members-panel";
import { InfiniteScrollSentinel } from "@/components/ui/infinite-scroll-sentinel";
import type { AlbumAssetDto, AlbumDetailDto } from "@/lib/albums/queries";

const PAGE_SIZE = 48;

export function AlbumDetailView({ albumId }: { albumId: string }) {
  const router = useRouter();
  const [album, setAlbum] = useState<AlbumDetailDto | null>(null);
  const [assets, setAssets] = useState<AlbumAssetDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadPage = useCallback(
    async (cursor?: string) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/albums/${albumId}?${params}`);
      if (!response.ok) {
        throw new Error(
          response.status === 404 ? "Album not found" : "Failed to load",
        );
      }
      return (await response.json()) as {
        album: AlbumDetailDto;
        nextCursor: string | null;
      };
    },
    [albumId],
  );

  const load = useCallback(async () => {
    try {
      const payload = await loadPage();
      setAlbum(payload.album);
      setAssets(payload.album.assets);
      setNextCursor(payload.nextCursor ?? payload.album.nextCursor);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [loadPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const payload = await loadPage(nextCursor);
      setAssets((current) => [...current, ...payload.album.assets]);
      setNextCursor(payload.nextCursor ?? payload.album.nextCursor);
      setError(null);
    } catch {
      setError("Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }, [loadPage, loadingMore, nextCursor]);

  useEffect(() => {
    void load();
  }, [load]);

  async function deleteAlbum() {
    if (!album) return;
    if (
      !confirm(
        `Delete album “${album.name}”? Media inside stays in your library.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    const response = await fetch(`/api/albums/${albumId}`, {
      method: "DELETE",
    });
    setDeleting(false);
    if (!response.ok) {
      setError("Failed to delete album");
      return;
    }
    router.push("/albums");
  }

  if (error && !album) {
    return (
      <div className="p-8 text-center text-sm text-destructive">{error}</div>
    );
  }

  if (!album) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Loading album…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Link
          href="/albums"
          className="inline-flex size-9 items-center justify-center rounded-full hover:bg-muted"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {album.name}
          </h1>
          <p className="text-xs text-muted-foreground">
            {album.assetCount} asset{album.assetCount === 1 ? "" : "s"}
            {album.role !== "owner"
              ? ` · shared by ${album.ownerUsername} · ${album.role}`
              : null}
          </p>
        </div>
        {album.canManageMembers ? (
          <button
            type="button"
            aria-label="Members"
            title="Members"
            className="inline-flex size-9 items-center justify-center rounded-full hover:bg-muted"
            onClick={() => setMembersOpen(true)}
          >
            <Users className="size-4" />
          </button>
        ) : null}
        {album.role === "owner" ? (
          <button
            type="button"
            aria-label="Delete album"
            title="Delete album"
            disabled={deleting}
            className="inline-flex size-9 items-center justify-center rounded-full hover:bg-muted disabled:opacity-50"
            onClick={() => void deleteAlbum()}
          >
            <Trash2 className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {error ? (
          <p className="mb-3 text-sm text-destructive">{error}</p>
        ) : null}
        {assets.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No assets in this album yet.
            </p>
            <Link href="/" className="text-sm text-primary hover:underline">
              Add from the timeline
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
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
                    loading="lazy"
                  />
                  <span className="absolute bottom-1.5 left-1.5 inline-flex rounded bg-black/55 p-1 text-white">
                    {asset.assetType === "video" ? (
                      <Film className="size-3" />
                    ) : (
                      <ImageIcon className="size-3" />
                    )}
                  </span>
                </Link>
              ))}
            </div>
            <InfiniteScrollSentinel
              enabled={Boolean(nextCursor)}
              loading={loadingMore}
              onLoadMore={() => void loadMore()}
            />
          </>
        )}
      </div>

      {membersOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4"
              onClick={() => setMembersOpen(false)}
            >
              <div
                className="dm-panel-enter w-full max-w-md rounded-2xl border border-border bg-card p-4 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">Members</p>
                    <p className="text-xs text-muted-foreground">{album.name}</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close"
                    className="inline-flex size-8 items-center justify-center rounded-full hover:bg-muted"
                    onClick={() => setMembersOpen(false)}
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <AlbumMembersPanel
                  albumId={albumId}
                  canManage={album.canManageMembers}
                  members={album.members}
                  onChanged={() => void load()}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
