"use client";

import Link from "next/link";
import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  Film,
  HardDrive,
  ImageIcon,
  Images,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DriveGroupThumb,
  revokeDriveThumbnails,
} from "@/components/upload/drive-group-thumb";
import {
  lookupDuplicates,
  xxhashFile,
} from "@/lib/upload/client-hash";
import {
  AUTO_HASH_MAX_BYTES,
  deleteDriveGroupFromCard,
  filesFromDriveGroup,
  formatBytesShort,
  groupDriveEntries,
  isDrivePickerSupported,
  pickDriveDirectory,
  scanDriveTree,
  type DriveDupStatus,
  type DriveImportGroup,
  type FsDirectoryHandle,
} from "@/lib/upload/drive-scan";
import { cn } from "@/lib/utils";

type SectionTab = "new" | "library" | "other";

function kindLabel(kind: DriveImportGroup["kind"]) {
  if (kind === "clip") return "Video";
  if (kind === "hyperlapse") return "Hyperlapse";
  if (kind === "panorama") return "Panorama";
  if (kind === "photo") return "Photo";
  return "Sidecar";
}

function statusChip(status: DriveDupStatus) {
  switch (status) {
    case "in_library":
      return {
        label: "Already imported",
        className: "bg-emerald-500/90 text-white",
      };
    case "likely_duplicate":
      return {
        label: "Possible duplicate",
        className: "bg-amber-500/90 text-white",
      };
    case "hashing":
      return {
        label: "Checking…",
        className: "bg-black/70 text-white",
      };
    case "error":
      return {
        label: "Check failed",
        className: "bg-destructive/90 text-white",
      };
    case "new":
      return null;
    default:
      return null;
  }
}

const GroupTile = memo(function GroupTile({
  group,
  mode,
  deleting,
  onToggle,
  onDelete,
}: {
  group: DriveImportGroup;
  mode: SectionTab;
  deleting: boolean;
  onToggle: (id: string) => void;
  onDelete: (group: DriveImportGroup) => void;
}) {
  const chip = statusChip(group.dupStatus);
  const selectable = mode === "new" && group.kind !== "orphan_sidecar";

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl bg-muted/40 ring-1 ring-border transition",
        selectable && group.selected && "ring-2 ring-primary",
        selectable && "cursor-pointer hover:ring-primary/60",
      )}
      style={{ contentVisibility: "auto", containIntrinsicSize: "220px" }}
      onClick={() => {
        if (selectable) onToggle(group.id);
      }}
      onKeyDown={(event) => {
        if (!selectable) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle(group.id);
        }
      }}
      role={selectable ? "checkbox" : undefined}
      aria-checked={selectable ? group.selected : undefined}
      tabIndex={selectable ? 0 : undefined}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-zinc-900">
        <DriveGroupThumb group={group} />

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-2.5 pb-2 pt-10">
          <p className="truncate text-xs font-medium text-white">{group.label}</p>
          <p className="truncate text-[10px] text-white/70">
            {kindLabel(group.kind)}
            {group.kind === "hyperlapse" || group.kind === "panorama"
              ? ` · ${group.files.length} tiles`
              : ""}
            {group.files.length > 1 && group.kind === "clip"
              ? ` · +${group.files.length - 1} linked`
              : ""}
            {" · "}
            {formatBytesShort(group.totalBytes)}
          </p>
        </div>

        {selectable ? (
          <span
            className={cn(
              "absolute left-2 top-2 flex size-6 items-center justify-center rounded-md border shadow-sm transition",
              group.selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-white/40 bg-black/45 text-transparent group-hover:text-white/80",
            )}
          >
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        ) : null}

        {chip ? (
          <span
            className={cn(
              "absolute right-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-medium shadow",
              chip.className,
            )}
          >
            {chip.label}
          </span>
        ) : (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
            {group.kind === "clip" ? (
              <Film className="size-3" />
            ) : group.kind === "hyperlapse" || group.kind === "panorama" ? (
              <Images className="size-3" />
            ) : (
              <ImageIcon className="size-3" />
            )}
            {kindLabel(group.kind)}
          </span>
        )}

        {group.missingLinked?.length && mode === "new" ? (
          <span className="absolute bottom-10 left-2 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
            Missing {group.missingLinked.join(", ").toUpperCase()}
          </span>
        ) : null}
      </div>

      {mode === "library" ? (
        <div className="flex items-center justify-between gap-2 border-t border-border px-2.5 py-2">
          {group.matchAssetId ? (
            <Link
              href={`/assets/${group.matchAssetId}`}
              className="truncate text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              Open in library
            </Link>
          ) : (
            <span className="text-[11px] text-muted-foreground">In library</span>
          )}
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={deleting}
            className="text-destructive"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(group);
            }}
          >
            <Trash2 className="size-3" />
            {deleting ? "…" : "Remove from card"}
          </Button>
        </div>
      ) : group.matchAssetId && mode === "new" ? (
        <div className="border-t border-border px-2.5 py-1.5">
          <Link
            href={`/assets/${group.matchAssetId}`}
            className="truncate text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            Similar: {group.matchDisplayName ?? "library item"}
          </Link>
        </div>
      ) : null}
    </div>
  );
});

export function DriveImportPanel({
  onQueueFiles,
  requireSrt,
}: {
  onQueueFiles: (files: File[]) => void;
  requireSrt?: boolean;
}) {
  const supported = useMemo(() => isDrivePickerSupported(), []);
  const [root, setRoot] = useState<FsDirectoryHandle | null>(null);
  const [rootName, setRootName] = useState<string | null>(null);
  const [groups, setGroups] = useState<DriveImportGroup[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({
    filesSeen: 0,
    mediaFound: 0,
  });
  const [checking, setChecking] = useState(false);
  const [hashProgress, setHashProgress] = useState<string | null>(null);
  const [tab, setTab] = useState<SectionTab>("new");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [includePhotos, setIncludePhotos] = useState(true);
  const [quota, setQuota] = useState<{
    usedBytes: number;
    quotaBytes: number;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void fetch("/api/account")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as {
          usedBytes: number;
          quotaBytes: number;
        };
      })
      .then((account) => {
        if (account) {
          setQuota({
            usedBytes: account.usedBytes,
            quotaBytes: account.quotaBytes,
          });
        }
      })
      .catch(() => undefined);

    return () => {
      abortRef.current?.abort();
      revokeDriveThumbnails();
    };
  }, []);

  const checkDuplicatesRef = useRef<
    (source: DriveImportGroup[], signal?: AbortSignal) => Promise<void>
  >(async () => undefined);

  const checkDuplicates = useCallback(
    async (source: DriveImportGroup[], signal?: AbortSignal) => {
      setChecking(true);
      setHashProgress(null);
      try {
        const soft = source
          .filter((g) => g.kind !== "orphan_sidecar")
          .map((g) => ({
            key: g.id,
            basename: g.primary.basename,
            sizeBytes:
              g.kind === "hyperlapse" || g.kind === "panorama"
                ? g.totalBytes
                : g.primary.sizeBytes,
          }));

        const softResult =
          soft.length > 0
            ? await lookupDuplicates({ soft })
            : { hashMatches: [], softMatches: [] };

        let working = source.map((group) => {
          const softHit = softResult.softMatches.find((m) => m.key === group.id);
          if (softHit) {
            return {
              ...group,
              dupStatus: "likely_duplicate" as const,
              matchAssetId: softHit.assetId,
              matchDisplayName: softHit.displayName,
              selected: false,
            };
          }
          return { ...group };
        });
        setGroups(working);

        const toHash = working.filter((group) => {
          if (group.kind === "orphan_sidecar") return false;
          if (group.dupStatus === "likely_duplicate") return true;
          return group.primary.sizeBytes <= AUTO_HASH_MAX_BYTES;
        });

        // Avoid per-file React commits (re-renders the whole grid). Flush in
        // batches and keep unchanged row object identity for memoized tiles.
        const flushWorking = (force = false) => {
          if (!force && (i + 1) % 4 !== 0) return;
          const snapshot = working;
          startTransition(() => setGroups(snapshot));
        };

        let i = 0;
        for (; i < toHash.length; i++) {
          if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
          const group = toHash[i]!;
          setHashProgress(`Checking ${i + 1} of ${toHash.length}`);

          try {
            const file = await group.primary.handle.getFile();
            const digest = await xxhashFile(file, { signal });
            const result = await lookupDuplicates({ digests: [digest] });
            const hit = result.hashMatches.find((m) => m.digest === digest);

            working = working.map((row) => {
              if (row.id !== group.id) return row;
              if (hit) {
                return {
                  ...row,
                  contentHash: digest,
                  dupStatus: "in_library" as const,
                  matchAssetId: hit.assetId,
                  matchDisplayName: hit.displayName,
                  selected: false,
                };
              }
              return {
                ...row,
                contentHash: digest,
                dupStatus: "new" as const,
                matchAssetId: null,
                matchDisplayName: null,
                selected: row.kind !== "orphan_sidecar",
              };
            });
            flushWorking();
            // Yield so thumbnails / paint can run between hashes.
            if (i % 2 === 1) {
              await new Promise<void>((r) => setTimeout(r, 0));
            }
          } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") {
              throw err;
            }
            working = working.map((row) =>
              row.id === group.id
                ? {
                    ...row,
                    dupStatus:
                      row.dupStatus === "likely_duplicate"
                        ? ("likely_duplicate" as const)
                        : ("error" as const),
                    hashError:
                      err instanceof Error ? err.message : "Hash failed",
                  }
                : row,
            );
            flushWorking();
          }
        }

        working = working.map((row) => {
          if (row.dupStatus === "unknown" && row.kind !== "orphan_sidecar") {
            return { ...row, dupStatus: "new" as const, selected: true };
          }
          return row;
        });
        setGroups(working);
        setMessage(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Duplicate check failed");
      } finally {
        setChecking(false);
        setHashProgress(null);
      }
    },
    [],
  );

  checkDuplicatesRef.current = checkDuplicates;

  const runScan = useCallback(async (directory: FsDirectoryHandle) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    revokeDriveThumbnails();
    setScanning(true);
    setError(null);
    setMessage(null);
    setGroups([]);
    setTab("new");
    setScanProgress({ filesSeen: 0, mediaFound: 0 });
    try {
      const entries = await scanDriveTree(directory, {
        signal: controller.signal,
        onProgress: setScanProgress,
      });
      const next = groupDriveEntries(entries);
      setGroups(next);
      setScanning(false);
      if (next.length === 0) {
        setMessage("No supported media found. Try selecting the DCIM folder.");
        return;
      }
      await checkDuplicatesRef.current(next, controller.signal);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Scan failed");
      setScanning(false);
    }
  }, []);

  async function onSelectDrive() {
    setError(null);
    try {
      const directory = await pickDriveDirectory();
      setRoot(directory);
      setRootName(directory.name || "Selected folder");
      await runScan(directory);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Could not open folder");
    }
  }

  async function onRescan() {
    if (!root) return;
    await runScan(root);
  }

  async function onCheckLarge() {
    const large = groups.filter(
      (g) =>
        g.kind !== "orphan_sidecar" &&
        g.dupStatus !== "in_library" &&
        g.primary.sizeBytes > AUTO_HASH_MAX_BYTES,
    );
    if (large.length === 0) {
      setMessage("All selectable items were already checked.");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    await checkDuplicates(
      groups.map((g) =>
        large.some((l) => l.id === g.id)
          ? { ...g, dupStatus: "likely_duplicate" as const }
          : g,
      ),
      controller.signal,
    );
  }

  const visibleGroups = useMemo(() => {
    return groups.filter((group) => {
      if (!includePhotos && group.kind === "photo") return false;
      if (tab === "new") {
        return (
          group.kind !== "orphan_sidecar" &&
          group.dupStatus !== "in_library"
        );
      }
      if (tab === "library") return group.dupStatus === "in_library";
      return group.kind === "orphan_sidecar";
    });
  }, [groups, includePhotos, tab]);

  const selectedNew = groups.filter(
    (g) =>
      g.selected &&
      g.dupStatus !== "in_library" &&
      g.kind !== "orphan_sidecar" &&
      (includePhotos || g.kind !== "photo"),
  );

  const selectedBytes = selectedNew.reduce((sum, g) => sum + g.totalBytes, 0);
  const remainingQuota = quota
    ? Math.max(0, quota.quotaBytes - quota.usedBytes)
    : null;
  const overQuota =
    remainingQuota != null ? selectedBytes > remainingQuota : false;

  const counts = {
    new: groups.filter(
      (g) =>
        g.kind !== "orphan_sidecar" &&
        g.dupStatus !== "in_library" &&
        (includePhotos || g.kind !== "photo"),
    ).length,
    library: groups.filter((g) => g.dupStatus === "in_library").length,
    other: groups.filter((g) => g.kind === "orphan_sidecar").length,
  };

  const toggleSelected = useCallback((id: string) => {
    setGroups((current) =>
      current.map((row) =>
        row.id === id ? { ...row, selected: !row.selected } : row,
      ),
    );
  }, []);

  function selectAllVisible(selected: boolean) {
    const ids = new Set(visibleGroups.map((g) => g.id));
    setGroups((current) =>
      current.map((row) =>
        ids.has(row.id) && row.dupStatus !== "in_library"
          ? { ...row, selected }
          : row,
      ),
    );
  }

  async function onUploadSelected() {
    setError(null);
    if (selectedNew.length === 0) {
      setMessage("Select at least one item to copy into the library.");
      return;
    }
    if (requireSrt) {
      const missing = selectedNew.filter(
        (g) => g.kind === "clip" && g.missingLinked?.includes("srt"),
      );
      if (missing.length > 0) {
        setError(
          `Mission template requires SRT — missing for ${missing
            .slice(0, 3)
            .map((m) => m.label)
            .join(", ")}${missing.length > 3 ? "…" : ""}`,
        );
        return;
      }
    }
    if (overQuota) {
      setError(
        `Selected media (${formatBytesShort(selectedBytes)}) exceeds remaining storage.`,
      );
      return;
    }

    try {
      const files: File[] = [];
      for (const group of selectedNew) {
        files.push(...(await filesFromDriveGroup(group)));
      }
      onQueueFiles(files);
      setMessage(
        `Copying ${selectedNew.length} item${selectedNew.length === 1 ? "" : "s"} into the library. Files stay on the card.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read files");
    }
  }

  const onDeleteFromCard = useCallback(async (group: DriveImportGroup) => {
    if (group.dupStatus !== "in_library") return;
    const listing = group.files
      .slice(0, 8)
      .map((f) => `• ${f.name}`)
      .join("\n");
    const more =
      group.files.length > 8 ? `\n• …and ${group.files.length - 8} more` : "";
    const ok = confirm(
      `Remove from the card only?\n\n${group.label}\n\n${listing}${more}\n\nYour library copy is kept. This cannot be undone on the card.`,
    );
    if (!ok) return;

    setDeletingId(group.id);
    setError(null);
    try {
      const result = await deleteDriveGroupFromCard(group);
      if (result.failed.length > 0) {
        setError(
          `Couldn’t finish removing from the card:\n${result.failed
            .map((f) => `${f.path}: ${f.error}`)
            .join("\n")}`,
        );
      } else {
        setMessage(`Removed “${group.label}” from the card.`);
      }
      revokeDriveThumbnails([group.id]);
      setGroups((current) => current.filter((row) => row.id !== group.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }, []);

  if (!supported) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
        <HardDrive className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">Drive import needs Chrome or Edge</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          Use Browse folder or drag-and-drop below instead.
        </p>
      </div>
    );
  }

  // Empty / idle state — big clear CTA
  if (!root && !scanning) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-muted/40 to-background">
        <div className="flex flex-col items-center px-6 py-12 text-center sm:px-10">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <HardDrive className="size-7" />
          </div>
          <h2 className="mt-4 text-xl font-semibold tracking-tight">
            Import from SD card or drone
          </h2>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            Choose the drive or DCIM folder. We’ll show thumbnails of what’s new,
            skip what’s already in your library, and copy only what you pick.
          </p>

          <ol className="mt-6 grid w-full max-w-xl gap-3 text-left text-sm sm:grid-cols-3">
            {[
              { n: "1", t: "Select folder", d: "SD card, drone, or DCIM" },
              { n: "2", t: "Review media", d: "Thumbnails + duplicates" },
              { n: "3", t: "Copy to library", d: "Card stays untouched" },
            ].map((step) => (
              <li
                key={step.n}
                className="rounded-xl border border-border/80 bg-background/80 px-3 py-3"
              >
                <p className="text-xs font-semibold text-primary">Step {step.n}</p>
                <p className="mt-1 font-medium">{step.t}</p>
                <p className="text-xs text-muted-foreground">{step.d}</p>
              </li>
            ))}
          </ol>

          <Button
            type="button"
            size="lg"
            className="mt-8"
            onClick={() => void onSelectDrive()}
          >
            <HardDrive className="size-4" />
            Select drive / card
          </Button>
          {error ? (
            <p className="mt-3 text-sm text-destructive">{error}</p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-background p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">
            Import from card
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {rootName}
            {scanning
              ? ` · scanning… ${scanProgress.mediaFound} media found`
              : checking && hashProgress
                ? ` · ${hashProgress}`
                : groups.length > 0
                  ? ` · ${groups.length} items`
                  : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={scanning || checking}
            onClick={() => void onRescan()}
          >
            <RefreshCw className="size-3.5" />
            Rescan
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void onSelectDrive()}
          >
            Change folder
          </Button>
        </div>
      </div>

      {(scanning || checking) && groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-muted/30 py-16">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm font-medium">
            {scanning ? "Scanning your card…" : "Checking what’s already imported…"}
          </p>
          <p className="text-xs text-muted-foreground">
            {scanning
              ? `${scanProgress.filesSeen} files looked at · ${scanProgress.mediaFound} media`
              : hashProgress}
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="whitespace-pre-wrap rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}

      {groups.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
            {(
              [
                ["new", "Ready to copy", counts.new],
                ["library", "Already in library", counts.library],
                ["other", "Other", counts.other],
              ] as const
            ).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition",
                  tab === id
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                )}
              >
                {label}
                <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
              </button>
            ))}
            <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includePhotos}
                onChange={(event) => setIncludePhotos(event.target.checked)}
              />
              Photos
            </label>
          </div>

          {tab === "new" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => selectAllVisible(true)}
              >
                Select all
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => selectAllVisible(false)}
              >
                Clear
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={checking}
                onClick={() => void onCheckLarge()}
              >
                Check large files
              </Button>
              {checking ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  {hashProgress ?? "Checking…"}
                </span>
              ) : null}
            </div>
          ) : tab === "library" ? (
            <p className="text-xs text-muted-foreground">
              These are already in your library. You can free space on the card by
              removing them here — library copies are not deleted.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Sidecar files without a matching video in this folder. Upload the
              video first, or drop these later to attach.
            </p>
          )}

          {visibleGroups.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nothing here
              {tab === "new" ? " — everything may already be in your library." : "."}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
              {visibleGroups.map((group) => (
                <GroupTile
                  key={group.id}
                  group={group}
                  mode={tab}
                  deleting={deletingId === group.id}
                  onToggle={toggleSelected}
                  onDelete={onDeleteFromCard}
                />
              ))}
            </div>
          )}

          {tab === "new" && selectedNew.length > 0 ? (
            <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
              <div className="text-sm">
                <span className="font-semibold tabular-nums">
                  {selectedNew.length}
                </span>{" "}
                selected
                <span className="text-muted-foreground">
                  {" "}
                  · {formatBytesShort(selectedBytes)}
                  {remainingQuota != null
                    ? ` · ${formatBytesShort(remainingQuota)} free`
                    : ""}
                </span>
                {overQuota ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Exceeds remaining storage quota
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Copies into the library — card files stay put
                  </p>
                )}
              </div>
              <Button
                type="button"
                size="lg"
                disabled={overQuota || scanning || checking}
                onClick={() => void onUploadSelected()}
              >
                Copy to library
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
