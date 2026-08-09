/**
 * Drive / SD-card scan via File System Access API (Chromium).
 * Metadata-only walk + grouping into clips / hyperlapses / photos.
 */

import {
  isPhotoExtension,
  isProxyExtension,
  isTelemetryExtension,
  isVideoExtension,
  normalizeBasename,
} from "@/lib/upload/filename";
import {
  MIN_HYPERLAPSE_FRAMES,
  MIN_PANORAMA_FRAMES,
  panoramaFolderCaptureIndex,
  parseDjiStitchedPanoramaFilename,
  parseHyperlapseFilename,
  parsePanoramaFilename,
  parentFolderOf,
  sequenceDisplayName,
} from "@/lib/upload/sequences";

/** Minimal FS Access types (Chromium). */
export type FsFileHandle = {
  kind: "file";
  name: string;
  getFile: () => Promise<File>;
  remove?: () => Promise<void>;
};

export type FsDirectoryHandle = {
  kind: "directory";
  name: string;
  values: () => AsyncIterableIterator<FsFileHandle | FsDirectoryHandle>;
  getDirectoryHandle: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<FsDirectoryHandle>;
  getFileHandle: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<FsFileHandle>;
  removeEntry: (
    name: string,
    options?: { recursive?: boolean },
  ) => Promise<void>;
  queryPermission?: (descriptor?: {
    mode?: "read" | "readwrite";
  }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: {
    mode?: "read" | "readwrite";
  }) => Promise<PermissionState>;
};

export type DriveFileEntry = {
  id: string;
  name: string;
  relativePath: string;
  extension: string;
  basename: string;
  sizeBytes: number;
  lastModified: number;
  handle: FsFileHandle;
  /** Directory that contains this file. */
  parentHandle: FsDirectoryHandle;
  /** Parent of parentHandle (null when file is at scan root). */
  grandparentHandle: FsDirectoryHandle | null;
};

export type DriveGroupKind =
  | "clip"
  | "hyperlapse"
  | "panorama"
  | "photo"
  | "orphan_sidecar";

export type DriveDupStatus =
  | "unknown"
  | "new"
  | "likely_duplicate"
  | "in_library"
  | "hashing"
  | "error";

export type DriveImportGroup = {
  id: string;
  kind: DriveGroupKind;
  label: string;
  /** Folder relative path for hyperlapse; parent folder for clips. */
  relativeFolder: string | null;
  files: DriveFileEntry[];
  primary: DriveFileEntry;
  totalBytes: number;
  missingLinked?: Array<"srt" | "lrf">;
  /** Parent of the hyperlapse folder — used for recursive folder delete. */
  folderParentHandle?: FsDirectoryHandle;
  folderName?: string;
  selected: boolean;
  dupStatus: DriveDupStatus;
  matchAssetId?: string | null;
  matchDisplayName?: string | null;
  contentHash?: string | null;
  hashError?: string | null;
};

const IGNORE_NAMES = new Set([
  "thumbs.db",
  ".ds_store",
  "desktop.ini",
  ".trashes",
  ".spotlight-v100",
  ".fseventsd",
]);

function shouldIgnoreName(name: string): boolean {
  const lower = name.toLowerCase();
  if (IGNORE_NAMES.has(lower)) return true;
  if (name.startsWith("._")) return true;
  if (name.startsWith(".") && name !== ".") return true;
  return false;
}

function extensionOf(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return "";
  return name.slice(idx + 1).toLowerCase();
}

function basenameOf(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return name;
  return name.slice(0, idx);
}

export function isDrivePickerSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickDriveDirectory(): Promise<FsDirectoryHandle> {
  if (!isDrivePickerSupported()) {
    throw new Error("Directory picker is not supported in this browser");
  }
  const picker = (
    window as unknown as {
      showDirectoryPicker: (opts?: {
        mode?: "read" | "readwrite";
      }) => Promise<FsDirectoryHandle>;
    }
  ).showDirectoryPicker;
  return picker({ mode: "readwrite" });
}

export async function ensureReadwritePermission(
  root: FsDirectoryHandle,
): Promise<boolean> {
  if (!root.queryPermission || !root.requestPermission) return true;
  const current = await root.queryPermission({ mode: "readwrite" });
  if (current === "granted") return true;
  const next = await root.requestPermission({ mode: "readwrite" });
  return next === "granted";
}

export type DriveScanProgress = {
  filesSeen: number;
  mediaFound: number;
};

/**
 * Recursively walk a directory handle and collect media file entries.
 */
export async function scanDriveTree(
  root: FsDirectoryHandle,
  options?: {
    signal?: AbortSignal;
    onProgress?: (progress: DriveScanProgress) => void;
  },
): Promise<DriveFileEntry[]> {
  const out: DriveFileEntry[] = [];
  let filesSeen = 0;

  async function walk(
    dir: FsDirectoryHandle,
    pathPrefix: string,
    parentOfDir: FsDirectoryHandle | null,
  ): Promise<void> {
    if (options?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    for await (const entry of dir.values()) {
      if (options?.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      if (shouldIgnoreName(entry.name)) continue;

      if (entry.kind === "directory") {
        const nextPrefix = pathPrefix
          ? `${pathPrefix}/${entry.name}`
          : entry.name;
        // Skip known non-media DJI containers (BURST only — PANORAMA is imported)
        const upper = entry.name.toUpperCase();
        if (upper === "BURST") continue;
        await walk(entry as FsDirectoryHandle, nextPrefix, dir);
        continue;
      }

      filesSeen += 1;
      const ext = extensionOf(entry.name);
      const isMedia =
        isVideoExtension(ext) ||
        isPhotoExtension(ext) ||
        isTelemetryExtension(ext) ||
        isProxyExtension(ext);
      if (!isMedia) {
        options?.onProgress?.({
          filesSeen,
          mediaFound: out.length,
        });
        continue;
      }

      const file = await entry.getFile();
      const relativePath = pathPrefix
        ? `${pathPrefix}/${entry.name}`
        : entry.name;
      out.push({
        id: `${relativePath}::${file.size}::${file.lastModified}`,
        name: entry.name,
        relativePath,
        extension: ext,
        basename: basenameOf(entry.name),
        sizeBytes: file.size,
        lastModified: file.lastModified,
        handle: entry as FsFileHandle,
        parentHandle: dir,
        grandparentHandle: parentOfDir,
      });
      options?.onProgress?.({
        filesSeen,
        mediaFound: out.length,
      });
    }
  }

  await walk(root, "", null);
  return out;
}

function makeGroupId(kind: string, key: string): string {
  return `${kind}:${key}`;
}

/**
 * Group scanned media into clip / hyperlapse / panorama / photo / orphan sidecar rows.
 */
export function groupDriveEntries(entries: DriveFileEntry[]): DriveImportGroup[] {
  const byFolderHyper: Map<string, DriveFileEntry[]> = new Map();
  const byFolderPano: Map<string, DriveFileEntry[]> = new Map();
  const rest: DriveFileEntry[] = [];

  for (const entry of entries) {
    const folder = parentFolderOf(entry.relativePath);
    const hyper = parseHyperlapseFilename(entry.name);
    const pano = parsePanoramaFilename(entry.name);
    if (folder && hyper && isPhotoExtension(entry.extension)) {
      const list = byFolderHyper.get(folder) ?? [];
      list.push(entry);
      byFolderHyper.set(folder, list);
    } else if (folder && pano && isPhotoExtension(entry.extension)) {
      const list = byFolderPano.get(folder) ?? [];
      list.push(entry);
      byFolderPano.set(folder, list);
    } else {
      rest.push(entry);
    }
  }

  const groups: DriveImportGroup[] = [];
  const consumed = new Set<string>();

  function pushSequenceGroup(
    kind: "hyperlapse" | "panorama",
    folder: string,
    folderFiles: DriveFileEntry[],
    parse: typeof parseHyperlapseFilename,
    minFrames: number,
  ) {
    const frames = folderFiles
      .map((file) => {
        const parsed = parse(file.name);
        return parsed ? { file, frameNumber: parsed.frameNumber } : null;
      })
      .filter(
        (row): row is { file: DriveFileEntry; frameNumber: number } =>
          row != null,
      )
      .sort((a, b) => a.frameNumber - b.frameNumber);

    if (frames.length >= minFrames) {
      const files = frames.map((row) => row.file);
      for (const file of files) consumed.add(file.id);
      const primary = files[0]!;
      const folderName = folder.includes("/")
        ? folder.slice(folder.lastIndexOf("/") + 1)
        : folder;
      groups.push({
        id: makeGroupId(kind, folder),
        kind,
        label: sequenceDisplayName(folder, kind),
        relativeFolder: folder,
        files,
        primary,
        totalBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0),
        folderParentHandle: primary.grandparentHandle ?? undefined,
        folderName,
        selected: true,
        dupStatus: "unknown",
      });
    } else {
      rest.push(...folderFiles);
    }
  }

  for (const [folder, folderFiles] of byFolderHyper) {
    pushSequenceGroup(
      "hyperlapse",
      folder,
      folderFiles,
      parseHyperlapseFilename,
      MIN_HYPERLAPSE_FRAMES,
    );
  }

  for (const [folder, folderFiles] of byFolderPano) {
    pushSequenceGroup(
      "panorama",
      folder,
      folderFiles,
      parsePanoramaFilename,
      MIN_PANORAMA_FRAMES,
    );
  }

  // Pair DJI in-drone stitch (100MEDIA/DJI_0424.JPG) with PANORAMA/100_0424.
  for (const group of groups) {
    if (group.kind !== "panorama") continue;
    const index = panoramaFolderCaptureIndex(
      group.folderName ?? group.relativeFolder,
    );
    if (!index) continue;
    const stitched = rest.find((entry) => {
      if (consumed.has(entry.id)) return false;
      const parsed = parseDjiStitchedPanoramaFilename(entry.name);
      return parsed?.captureIndex === index;
    });
    if (!stitched) continue;
    consumed.add(stitched.id);
    group.files.push(stitched);
    group.primary = stitched;
    group.totalBytes += stitched.sizeBytes;
    group.label = `${group.label} · DJI stitch`;
  }

  // Hint that tile-only panoramas can attach to a prior DJI_XXXX upload.
  for (const group of groups) {
    if (group.kind !== "panorama") continue;
    if (group.label.includes("DJI stitch")) continue;
    const index = panoramaFolderCaptureIndex(
      group.folderName ?? group.relativeFolder,
    );
    if (!index) continue;
    group.label = `${group.label} · pairs with DJI_${index}`;
  }

  const remaining = rest.filter((entry) => !consumed.has(entry.id));

  // Basename groups for video + sidecars (case-insensitive basename)
  const byBasename = new Map<string, DriveFileEntry[]>();
  for (const entry of remaining) {
    if (
      isVideoExtension(entry.extension) ||
      isTelemetryExtension(entry.extension) ||
      isProxyExtension(entry.extension)
    ) {
      const key = normalizeBasename(entry.basename);
      const list = byBasename.get(key) ?? [];
      list.push(entry);
      byBasename.set(key, list);
    }
  }

  for (const [key, list] of byBasename) {
    const video = list.find((f) => isVideoExtension(f.extension));
    if (!video) {
      // Orphan sidecars only — still show so user can attach later via normal upload
      for (const file of list) {
        groups.push({
          id: makeGroupId("orphan", file.id),
          kind: "orphan_sidecar",
          label: file.name,
          relativeFolder: parentFolderOf(file.relativePath),
          files: [file],
          primary: file,
          totalBytes: file.sizeBytes,
          selected: false,
          dupStatus: "unknown",
        });
      }
      continue;
    }

    const srt = list.find((f) => isTelemetryExtension(f.extension));
    const lrf = list.find((f) => isProxyExtension(f.extension));
    const files = [video, srt, lrf].filter(Boolean) as DriveFileEntry[];
    for (const file of files) consumed.add(file.id);

    const missingLinked: Array<"srt" | "lrf"> = [];
    if (!srt) missingLinked.push("srt");
    if (!lrf) missingLinked.push("lrf");

    groups.push({
      id: makeGroupId("clip", `${parentFolderOf(video.relativePath) ?? ""}/${key}`),
      kind: "clip",
      label: video.name,
      relativeFolder: parentFolderOf(video.relativePath),
      files,
      primary: video,
      totalBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0),
      missingLinked: missingLinked.length ? missingLinked : undefined,
      selected: true,
      dupStatus: "unknown",
    });
  }

  // Remaining photos (non-sequence)
  for (const entry of remaining) {
    if (consumed.has(entry.id)) continue;
    if (!isPhotoExtension(entry.extension)) continue;
    groups.push({
      id: makeGroupId("photo", entry.id),
      kind: "photo",
      label: entry.name,
      relativeFolder: parentFolderOf(entry.relativePath),
      files: [entry],
      primary: entry,
      totalBytes: entry.sizeBytes,
      selected: true,
      dupStatus: "unknown",
    });
  }

  // Sort: clips, hyperlapses, panoramas, photos, orphans — by path
  const order: Record<DriveGroupKind, number> = {
    clip: 0,
    hyperlapse: 1,
    panorama: 2,
    photo: 3,
    orphan_sidecar: 4,
  };
  groups.sort((a, b) => {
    const ko = order[a.kind] - order[b.kind];
    if (ko !== 0) return ko;
    return a.primary.relativePath.localeCompare(b.primary.relativePath);
  });

  return groups;
}

/** Resolve File objects with relative paths for the existing upload queue. */
export async function filesFromDriveGroup(
  group: DriveImportGroup,
): Promise<File[]> {
  const { setFileRelativePath } = await import("@/lib/upload/relative-path");
  const out: File[] = [];
  for (const entry of group.files) {
    const file = await entry.handle.getFile();
    setFileRelativePath(file, entry.relativePath);
    out.push(file);
  }
  return out;
}

/**
 * Delete an entire import group from the card.
 * Clips: each file. Hyperlapse: recursive folder remove when possible.
 */
export async function deleteDriveGroupFromCard(
  group: DriveImportGroup,
): Promise<{ deleted: string[]; failed: Array<{ path: string; error: string }> }> {
  const deleted: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];

  if (
    (group.kind === "hyperlapse" || group.kind === "panorama") &&
    group.folderParentHandle &&
    group.folderName
  ) {
    try {
      await group.folderParentHandle.removeEntry(group.folderName, {
        recursive: true,
      });
      deleted.push(group.relativeFolder ?? group.folderName);
      return { deleted, failed };
    } catch (error) {
      failed.push({
        path: group.relativeFolder ?? group.folderName,
        error: error instanceof Error ? error.message : "Failed to remove folder",
      });
      // Fall through to per-file delete
    }
  }

  for (const entry of group.files) {
    try {
      if (entry.handle.remove) {
        await entry.handle.remove();
      } else {
        await entry.parentHandle.removeEntry(entry.name);
      }
      deleted.push(entry.relativePath);
    } catch (error) {
      failed.push({
        path: entry.relativePath,
        error: error instanceof Error ? error.message : "Delete failed",
      });
      // Stop on first failure mid-group so user knows what remains
      break;
    }
  }

  return { deleted, failed };
}

export function formatBytesShort(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Auto-hash threshold from the plan (~2 GB). */
export const AUTO_HASH_MAX_BYTES = 2 * 1024 * 1024 * 1024;
