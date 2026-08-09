const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  dng: "image/x-adobe-dng",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  srt: "application/x-subrip",
  lrf: "application/octet-stream",
};

export function mimeTypeForExtension(extension: string): string {
  const normalized = extension.replace(/^\./, "").toLowerCase();
  return MIME_BY_EXT[normalized] ?? "application/octet-stream";
}
