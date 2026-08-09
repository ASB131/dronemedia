import path from "node:path";

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mov",
  "mkv",
  "avi",
  "m4v",
  "webm",
  "insv",
]);

const PHOTO_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "dng",
  "raw",
  "tif",
  "tiff",
  "heic",
  "heif",
]);

const TELEMETRY_EXTENSIONS = new Set(["srt"]);
const PROXY_EXTENSIONS = new Set(["lrf"]);

export type ParsedFilename = {
  displayName: string;
  basename: string;
  extension: string;
};

export function parseFilename(filename: string): ParsedFilename {
  const displayName = path.basename(filename);
  const extension = path.extname(displayName).replace(/^\./, "").toLowerCase();
  const basename = path.basename(displayName, path.extname(displayName));
  return { displayName, basename, extension };
}

export function normalizeBasename(basename: string): string {
  return basename.toLowerCase();
}

/**
 * Group key for pairing media with sidecars.
 * Handles DJI-style `DJI_0001.MP4.SRT` → pairs with `DJI_0001.MP4`.
 */
export function groupKeyForUploadFile(basename: string, extension: string): string {
  let key = normalizeBasename(basename);
  if (!isTelemetryExtension(extension) && !isProxyExtension(extension)) {
    return key;
  }
  const nested = path.extname(basename).replace(/^\./, "").toLowerCase();
  if (nested && (isVideoExtension(nested) || isPhotoExtension(nested))) {
    key = normalizeBasename(path.basename(basename, path.extname(basename)));
  }
  return key;
}

export function isVideoExtension(ext: string): boolean {
  return VIDEO_EXTENSIONS.has(ext.toLowerCase());
}

export function isPhotoExtension(ext: string): boolean {
  return PHOTO_EXTENSIONS.has(ext.toLowerCase());
}

export function isTelemetryExtension(ext: string): boolean {
  return TELEMETRY_EXTENSIONS.has(ext.toLowerCase());
}

export function isProxyExtension(ext: string): boolean {
  return PROXY_EXTENSIONS.has(ext.toLowerCase());
}

export function inferAssetType(
  extensions: string[],
): "photo" | "video" | null {
  if (extensions.some(isVideoExtension)) return "video";
  if (extensions.some(isPhotoExtension)) return "photo";
  return null;
}

export function pickMainExtension(extensions: string[]): string | null {
  const video = extensions.find(isVideoExtension);
  if (video) return video;
  const photo = extensions.find(isPhotoExtension);
  if (photo) return photo;
  return extensions[0] ?? null;
}

export function pickMainDisplayName(
  files: Array<{ displayName: string; extension: string }>,
): string {
  const mainExt = pickMainExtension(files.map((f) => f.extension));
  const main =
    files.find((f) => f.extension === mainExt) ??
    files.find((f) => isVideoExtension(f.extension) || isPhotoExtension(f.extension)) ??
    files[0];
  return main?.displayName ?? "Untitled";
}
