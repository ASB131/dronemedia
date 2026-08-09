"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Film, ImageIcon, Images, Plane, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SearchResults } from "@/lib/search/queries";

function formatCapturedAt(capturedAt: string) {
  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) return "Unknown date";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(date);
}

export function SearchResultsView({
  initialQuery,
}: {
  initialQuery: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    let mounted = true;
    const trimmed = initialQuery.trim();

    async function load() {
      if (!trimmed) {
        if (mounted) {
          setError(null);
          setResults({ assets: [], flights: [], nextCursor: null });
        }
        return;
      }

      const params = new URLSearchParams({ q: trimmed, limit: "48" });
      const response = await fetch(`/api/search?${params.toString()}`);
      if (!response.ok) {
        if (mounted) setError("Search failed");
        return;
      }
      if (mounted) {
        setError(null);
        setResults((await response.json()) as SearchResults);
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, [initialQuery]);

  async function loadMore() {
    if (!results?.nextCursor || isLoadingMore) return;
    const trimmed = initialQuery.trim();
    if (!trimmed) return;

    setIsLoadingMore(true);
    const params = new URLSearchParams({
      q: trimmed,
      limit: "48",
      cursor: results.nextCursor,
    });

    try {
      const response = await fetch(`/api/search?${params.toString()}`);
      if (!response.ok) throw new Error("Search failed");

      const nextPage = (await response.json()) as SearchResults;
      setResults((current) =>
        current
          ? {
              ...nextPage,
              flights: current.flights,
              assets: [...current.assets, ...nextPage.assets],
            }
          : nextPage,
      );
      setError(null);
    } catch {
      setError("Search failed");
    } finally {
      setIsLoadingMore(false);
    }
  }

  const trimmed = initialQuery.trim();
  const total =
    (results?.assets.length ?? 0) + (results?.flights.length ?? 0);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-4">
        <h1 className="text-lg font-semibold">Search</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Search by filename, drone, place, date, tags, or description
        </p>
        <form
          className="mt-3 flex h-11 max-w-2xl items-center gap-2 rounded-full border border-border bg-muted/40 px-4 text-sm focus-within:border-primary/40 focus-within:bg-background focus-within:ring-2 focus-within:ring-primary/20"
          onSubmit={(event) => {
            event.preventDefault();
            const next = query.trim();
            router.push(
              next ? `/search?q=${encodeURIComponent(next)}` : "/search",
            );
          }}
        >
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="e.g. Singapore, Mini 4 Pro, 2024, DJI_0123"
            className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
            autoFocus
          />
        </form>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {!trimmed ? (
          <p className="text-sm text-muted-foreground">
            Type something above to search your library.
          </p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !results ? (
          <p className="text-sm text-muted-foreground">Searching…</p>
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground">
            No matches for “{trimmed}”.
          </p>
        ) : (
          <div className="space-y-8">
            {results.assets.length > 0 ? (
              <section>
                <h2 className="mb-3 text-sm font-semibold">
                  Media{" "}
                  <span className="font-normal text-muted-foreground">
                    ({results.assets.length}
                    {results.nextCursor ? "+" : ""})
                  </span>
                </h2>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {results.assets.map((asset) => (
                    <Link
                      key={asset.id}
                      href={`/assets/${asset.id}`}
                      className="group relative block overflow-hidden rounded-lg bg-muted/40"
                      style={{
                        aspectRatio: String(
                          asset.aspectRatio > 0 ? asset.aspectRatio : 16 / 9,
                        ),
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/assets/${asset.id}/thumbnail`}
                        alt=""
                        className="size-full object-cover transition duration-150 group-hover:brightness-75"
                        loading="lazy"
                      />
                      <span className="pointer-events-none absolute bottom-1 left-1 inline-flex size-5 items-center justify-center rounded bg-black/55 text-white">
                        {asset.assetType === "video" ? (
                          <Film className="size-3" />
                        ) : asset.assetType === "sequence" ? (
                          <Images className="size-3" />
                        ) : (
                          <ImageIcon className="size-3" />
                        )}
                      </span>
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-2 pb-1.5 pt-8 opacity-0 transition group-hover:opacity-100">
                        <p className="truncate text-[11px] font-medium text-white">
                          {asset.displayName}
                        </p>
                        <p className="truncate text-[10px] text-white/75">
                          {formatCapturedAt(asset.capturedAt)}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
                {results.nextCursor ? (
                  <div className="mt-4 flex justify-center">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void loadMore()}
                      disabled={isLoadingMore}
                    >
                      {isLoadingMore ? "Loading…" : "Load more"}
                    </Button>
                  </div>
                ) : null}
              </section>
            ) : null}

            {results.flights.length > 0 ? (
              <section>
                <h2 className="mb-3 text-sm font-semibold">
                  Flights{" "}
                  <span className="font-normal text-muted-foreground">
                    ({results.flights.length})
                  </span>
                </h2>
                <ul className="space-y-2">
                  {results.flights.map((flight) => (
                    <li key={flight.id}>
                      <Link
                        href={`/flights/${flight.id}`}
                        className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-muted/40"
                      >
                        <Plane className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {flight.title ?? "Untitled flight"}
                          </span>
                          {flight.startTime ? (
                            <span className="text-xs text-muted-foreground">
                              {formatCapturedAt(flight.startTime)}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
