"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";

type PortfolioSettings = {
  coverAssetId: string | null;
  featuredAlbumIds: string[];
  showcaseAssetIds: string[];
  theme: "default" | "cinematic" | "minimal";
};

type AlbumOption = {
  id: string;
  name: string;
  assetCount: number;
};

type PublicAssetOption = {
  id: string;
  displayName: string;
  assetType: string;
};

export function PortfolioSettingsPanel({ username }: { username: string }) {
  const [portfolio, setPortfolio] = useState<PortfolioSettings | null>(null);
  const [albums, setAlbums] = useState<AlbumOption[]>([]);
  const [publicAssets, setPublicAssets] = useState<PublicAssetOption[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/account/portfolio");
    if (!response.ok) return;
    const payload = (await response.json()) as {
      portfolio: PortfolioSettings;
      albums: AlbumOption[];
      publicAssets: PublicAssetOption[];
    };
    setPortfolio(payload.portfolio);
    setAlbums(payload.albums);
    setPublicAssets(payload.publicAssets);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(patch: Partial<PortfolioSettings>) {
    if (!portfolio) return;
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/account/portfolio", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(false);
    if (!response.ok) {
      setMessage("Could not save portfolio settings");
      return;
    }
    const payload = (await response.json()) as { portfolio: PortfolioSettings };
    setPortfolio(payload.portfolio);
    setMessage("Saved");
  }

  if (!portfolio) {
    return (
      <p className="text-sm text-muted-foreground">Loading public page settings…</p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Customize your public profile at{" "}
          <Link
            href={`/u/${encodeURIComponent(username)}`}
            className="font-medium text-primary hover:underline"
          >
            /u/{username}
          </Link>
        </p>
        <Link
          href={`/u/${encodeURIComponent(username)}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Preview
          <ExternalLink className="size-3" />
        </Link>
      </div>

      {message ? (
        <p className="text-xs text-muted-foreground">{message}</p>
      ) : null}

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Theme</span>
        <select
          className="h-9 w-full max-w-xs rounded-lg border border-border bg-background px-2 text-sm"
          value={portfolio.theme}
          disabled={busy}
          onChange={(event) =>
            void save({
              theme: event.target.value as PortfolioSettings["theme"],
            })
          }
        >
          <option value="default">Default</option>
          <option value="cinematic">Cinematic</option>
          <option value="minimal">Minimal</option>
        </select>
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Cover image</span>
        <span className="block text-xs text-muted-foreground">
          Public assets only
        </span>
        <select
          className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm"
          value={portfolio.coverAssetId ?? ""}
          disabled={busy}
          onChange={(event) =>
            void save({
              coverAssetId: event.target.value || null,
            })
          }
        >
          <option value="">None</option>
          {publicAssets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.displayName}
            </option>
          ))}
        </select>
      </label>

      <div className="space-y-2">
        <span className="text-sm font-medium">Featured albums</span>
        <p className="text-xs text-muted-foreground">
          Select up to 20 albums to highlight on your public page.
        </p>
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
          {albums.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">No albums yet</p>
          ) : (
            albums.map((album) => {
              const checked = portfolio.featuredAlbumIds.includes(album.id);
              return (
                <label
                  key={album.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/40"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={() => {
                      const next = checked
                        ? portfolio.featuredAlbumIds.filter((id) => id !== album.id)
                        : [...portfolio.featuredAlbumIds, album.id].slice(0, 20);
                      void save({ featuredAlbumIds: next });
                    }}
                  />
                  <span className="truncate">
                    {album.name}{" "}
                    <span className="text-muted-foreground">
                      ({album.assetCount})
                    </span>
                  </span>
                </label>
              );
            })
          )}
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium">Showcase media</span>
        <p className="text-xs text-muted-foreground">
          Pin public photos or videos (max 40).
        </p>
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
          {publicAssets.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              Mark media as Public on an asset page first.
            </p>
          ) : (
            publicAssets.map((asset) => {
              const checked = portfolio.showcaseAssetIds.includes(asset.id);
              return (
                <label
                  key={asset.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/40"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={() => {
                      const next = checked
                        ? portfolio.showcaseAssetIds.filter((id) => id !== asset.id)
                        : [...portfolio.showcaseAssetIds, asset.id].slice(0, 40);
                      void save({ showcaseAssetIds: next });
                    }}
                  />
                  <span className="truncate">{asset.displayName}</span>
                </label>
              );
            })
          )}
        </div>
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => void load()}
      >
        Refresh lists
      </Button>
    </div>
  );
}
