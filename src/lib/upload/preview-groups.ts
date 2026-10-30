import { parseBasename } from "@/lib/upload/client";
import {
  groupKeyForUploadFile,
  inferAssetType,
  isProxyExtension,
  isTelemetryExtension,
  pickMainDisplayName,
  primaryMediaGroupKey,
  uploadRelativeFolder,
} from "@/lib/upload/filename";
import { getFileRelativePath } from "@/lib/upload/relative-path";
import {
  partitionHyperlapseSequences,
  partitionPanoramaSequences,
  sequenceDisplayName,
} from "@/lib/upload/sequences";

export type UploadGroupPreviewKind =
  | "clip"
  | "hyperlapse"
  | "panorama"
  | "photo"
  | "sidecar";

export type UploadGroupPreview = {
  id: string;
  kind: UploadGroupPreviewKind;
  label: string;
  files: string[];
  totalBytes: number;
  linked: string[];
};

type PreviewRow = {
  id: string;
  displayName: string;
  basename: string;
  extension: string;
  relativePath: string;
  sizeBytes: number;
};

function toPreviewRow(file: File, index: number): PreviewRow {
  const { basename, extension } = parseBasename(file.name);
  return {
    id: String(index),
    displayName: file.name,
    basename,
    extension,
    relativePath: getFileRelativePath(file) ?? file.name,
    sizeBytes: file.size,
  };
}

function linkedExtensions(extensions: string[]): string[] {
  const linked: string[] = [];
  if (extensions.some((ext) => ext.toLowerCase() === "srt")) linked.push("SRT");
  if (extensions.some((ext) => ext.toLowerCase() === "lrf")) linked.push("LRF");
  if (extensions.some(isProxyExtension)) linked.push("proxy");
  return linked;
}

function kindForGroup(
  extensions: string[],
  folder: string | null,
): UploadGroupPreviewKind {
  if (
    extensions.length > 0 &&
    extensions.every(
      (ext) => isTelemetryExtension(ext) || isProxyExtension(ext),
    )
  ) {
    return "sidecar";
  }
  const assetType = inferAssetType(extensions);
  if (assetType === "video") return "clip";
  if (assetType === "photo") return "photo";
  if (folder) return "photo";
  return "photo";
}

/** Client-side mirror of server commit grouping for manual uploads. */
export function buildUploadGroupPreview(files: File[]): UploadGroupPreview[] {
  if (files.length === 0) return [];

  const rows = files.map(toPreviewRow);
  const previews: UploadGroupPreview[] = [];

  const { sequences: hyperlapseGroups, remaining: afterHyperlapse } =
    partitionHyperlapseSequences(rows);
  for (const group of hyperlapseGroups) {
    previews.push({
      id: `hyper-${group.folder}`,
      kind: "hyperlapse",
      label: sequenceDisplayName(group.folder, "hyperlapse"),
      files: group.files.map((file) => file.displayName),
      totalBytes: group.files.reduce((sum, file) => sum + file.sizeBytes, 0),
      linked: [],
    });
  }

  const { sequences: panoramaGroups, remaining: nonSequenceFiles } =
    partitionPanoramaSequences(afterHyperlapse);
  for (const group of panoramaGroups) {
    previews.push({
      id: `pano-${group.folder}`,
      kind: "panorama",
      label: sequenceDisplayName(group.folder, "panorama"),
      files: group.files.map((file) => file.displayName),
      totalBytes: group.files.reduce((sum, file) => sum + file.sizeBytes, 0),
      linked: [],
    });
  }

  const groups = new Map<string, PreviewRow[]>();
  const sidecars: PreviewRow[] = [];

  for (const file of nonSequenceFiles) {
    if (isTelemetryExtension(file.extension) || isProxyExtension(file.extension)) {
      sidecars.push(file);
      continue;
    }
    const key = primaryMediaGroupKey({
      basename: file.basename,
      extension: file.extension,
      relativePath: file.relativePath,
    });
    const bucket = groups.get(key) ?? [];
    bucket.push(file);
    groups.set(key, bucket);
  }

  for (const sidecar of sidecars) {
    const base = groupKeyForUploadFile(sidecar.basename, sidecar.extension);
    const folder = uploadRelativeFolder(sidecar.relativePath);
    const sameFolderKey = folder ? `${folder}::${base}` : base;
    const targetKey = groups.has(sameFolderKey) ? sameFolderKey : null;
    if (targetKey) {
      groups.get(targetKey)!.push(sidecar);
    } else {
      const orphanKey = `sidecar::${base}`;
      const bucket = groups.get(orphanKey) ?? [];
      bucket.push(sidecar);
      groups.set(orphanKey, bucket);
    }
  }

  for (const [key, groupFiles] of groups) {
    const extensions = groupFiles.map((file) => file.extension);
    const folder = uploadRelativeFolder(groupFiles[0]!.relativePath) || null;
    const kind = kindForGroup(extensions, folder);
    const label =
      kind === "sidecar"
        ? `Sidecar · ${groupKeyForUploadFile(groupFiles[0]!.basename, groupFiles[0]!.extension)}`
        : pickMainDisplayName(
            groupFiles.map((file) => ({
              displayName: file.displayName,
              extension: file.extension,
            })),
          );

    previews.push({
      id: key,
      kind,
      label,
      files: groupFiles.map((file) => file.displayName),
      totalBytes: groupFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
      linked: linkedExtensions(extensions),
    });
  }

  return previews;
}
