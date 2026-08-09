/** Hyperlapse / panorama sequence detection for upload commit. */

export const HYPERLAPSE_FILENAME_RE = /^HYPERLAPSE_(\d+)\.(jpe?g)$/i;

export const PANORAMA_FILENAME_RE = /^PANO(\d+)\.(jpe?g)$/i;

/**
 * DJI in-drone / Fly-app stitched equirect, stored in 100MEDIA as DJI_0424.JPG
 * paired with PANORAMA/100_0424/ tiles.
 */
export const DJI_STITCHED_PANO_RE = /^DJI_(\d+)\.(jpe?g)$/i;

/** Minimum matching frames in one folder to form a sequence asset. */
export const MIN_HYPERLAPSE_FRAMES = 2;

export const MIN_PANORAMA_FRAMES = 2;

export type SequenceKind = "hyperlapse" | "panorama";

export type SequenceFrameCandidate = {
  fileId: string;
  filename: string;
  frameNumber: number;
  extension: string;
};

export type DetectedSequence = {
  folder: string;
  kind: SequenceKind;
  frames: SequenceFrameCandidate[];
};

export function normalizeRelativePath(
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  return normalized.length > 0 ? normalized : null;
}

/** Parent folder of a relative path, or null when file is at batch root. */
export function parentFolderOf(
  relativePath: string | null | undefined,
): string | null {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return null;
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return null;
  return normalized.slice(0, idx);
}

export function leafFilename(relativePathOrName: string): string {
  const normalized = relativePathOrName.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

export function parseHyperlapseFilename(
  filename: string,
): { frameNumber: number; extension: string } | null {
  const match = HYPERLAPSE_FILENAME_RE.exec(leafFilename(filename));
  if (!match) return null;
  return {
    frameNumber: Number.parseInt(match[1]!, 10),
    extension:
      match[2]!.toLowerCase() === "jpeg" ? "jpeg" : match[2]!.toLowerCase(),
  };
}

export function parsePanoramaFilename(
  filename: string,
): { frameNumber: number; extension: string } | null {
  const match = PANORAMA_FILENAME_RE.exec(leafFilename(filename));
  if (!match) return null;
  return {
    frameNumber: Number.parseInt(match[1]!, 10),
    extension:
      match[2]!.toLowerCase() === "jpeg" ? "jpeg" : match[2]!.toLowerCase(),
  };
}

/** Parse DJI_0424.JPG → { captureIndex: "0424", extension }. */
export function parseDjiStitchedPanoramaFilename(
  filename: string,
): { captureIndex: string; extension: string } | null {
  const match = DJI_STITCHED_PANO_RE.exec(leafFilename(filename));
  if (!match) return null;
  return {
    captureIndex: match[1]!,
    extension:
      match[2]!.toLowerCase() === "jpeg" ? "jpeg" : match[2]!.toLowerCase(),
  };
}

/**
 * PANORAMA/100_0424 → "0424" (matches DJI_0424.JPG).
 * Returns null when the folder name has no trailing index.
 */
export function panoramaFolderCaptureIndex(
  folder: string | null | undefined,
): string | null {
  if (!folder) return null;
  const leaf = leafFilename(folder);
  const match = /(?:^|_)(\d{3,5})$/.exec(leaf);
  return match?.[1] ?? null;
}

export function isDjiStitchedPanoramaFilename(filename: string): boolean {
  return parseDjiStitchedPanoramaFilename(filename) != null;
}

function partitionByFilenamePattern<
  T extends { id: string; displayName: string; relativePath: string | null },
>(
  files: T[],
  parse: (
    filename: string,
  ) => { frameNumber: number; extension: string } | null,
  minFrames: number,
): {
  sequences: Array<{ folder: string; files: T[] }>;
  remaining: T[];
} {
  const byFolder = new Map<string, T[]>();
  const rootOrOther: T[] = [];

  for (const file of files) {
    const folder = parentFolderOf(file.relativePath);
    const parsed = parse(file.relativePath ?? file.displayName);
    if (folder && parsed) {
      const list = byFolder.get(folder) ?? [];
      list.push(file);
      byFolder.set(folder, list);
    } else {
      rootOrOther.push(file);
    }
  }

  const sequences: Array<{ folder: string; files: T[] }> = [];
  for (const [folder, folderFiles] of byFolder) {
    const frames = folderFiles
      .map((file) => {
        const parsed = parse(file.relativePath ?? file.displayName);
        return parsed ? { file, frameNumber: parsed.frameNumber } : null;
      })
      .filter((row): row is { file: T; frameNumber: number } => row != null)
      .sort((a, b) => a.frameNumber - b.frameNumber);

    if (frames.length >= minFrames) {
      sequences.push({
        folder,
        files: frames.map((row) => row.file),
      });
    } else {
      rootOrOther.push(...folderFiles);
    }
  }

  return { sequences, remaining: rootOrOther };
}

export function partitionHyperlapseSequences<
  T extends { id: string; displayName: string; relativePath: string | null },
>(files: T[]): {
  sequences: Array<{ folder: string; files: T[] }>;
  remaining: T[];
} {
  return partitionByFilenamePattern(
    files,
    parseHyperlapseFilename,
    MIN_HYPERLAPSE_FRAMES,
  );
}

export function partitionPanoramaSequences<
  T extends { id: string; displayName: string; relativePath: string | null },
>(files: T[]): {
  sequences: Array<{ folder: string; files: T[] }>;
  remaining: T[];
} {
  const { sequences, remaining } = partitionByFilenamePattern(
    files,
    parsePanoramaFilename,
    MIN_PANORAMA_FRAMES,
  );

  // Attach DJI_XXXX.JPG from 100MEDIA (or anywhere in the batch) to the
  // matching PANORAMA/100_XXXX tile group so we can use the official stitch.
  const unused: T[] = [];
  const byIndex = new Map<string, T>();
  for (const file of remaining) {
    const parsed = parseDjiStitchedPanoramaFilename(
      file.relativePath ?? file.displayName,
    );
    if (parsed && !byIndex.has(parsed.captureIndex)) {
      byIndex.set(parsed.captureIndex, file);
    } else {
      unused.push(file);
    }
  }

  for (const sequence of sequences) {
    const index = panoramaFolderCaptureIndex(sequence.folder);
    if (!index) continue;
    const stitched = byIndex.get(index);
    if (!stitched) continue;
    sequence.files.push(stitched);
    byIndex.delete(index);
  }

  for (const orphan of byIndex.values()) {
    unused.push(orphan);
  }

  return { sequences, remaining: unused };
}

export function sequenceDisplayName(
  folder: string,
  kind: SequenceKind = "hyperlapse",
): string {
  const leaf = leafFilename(folder);
  if (kind === "hyperlapse") return `Hyperlapse · ${leaf}`;
  if (kind === "panorama") return `Panorama · ${leaf}`;
  return leaf;
}

/** Last path segment used as sequenceFolder on the asset. */
export function sequenceFolderLabel(folder: string): string {
  return leafFilename(folder);
}
