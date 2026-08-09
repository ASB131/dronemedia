import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ExifToolTags = Record<string, unknown>;

let available: boolean | null = null;

export async function exiftoolAvailable(): Promise<boolean> {
  if (available != null) return available;
  try {
    await execFileAsync("exiftool", ["-ver"], { timeout: 5_000 });
    available = true;
  } catch {
    available = false;
  }
  return available;
}

/**
 * Read metadata with ExifTool. `-n` returns numeric GPS/exposure values.
 * Returns null when ExifTool is missing or the file cannot be read.
 */
export async function readExifToolTags(
  filePath: string,
): Promise<ExifToolTags | null> {
  if (!(await exiftoolAvailable())) return null;

  try {
    const { stdout } = await execFileAsync(
      "exiftool",
      ["-j", "-n", "-fast2", filePath],
      { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as ExifToolTags[];
    return parsed[0] ?? null;
  } catch {
    return null;
  }
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function gpsFromExifTool(tags: ExifToolTags | null): {
  latitude: number;
  longitude: number;
  altitudeMeters: number | null;
} | null {
  if (!tags) return null;
  const latitude = asNumber(tags.GPSLatitude);
  const longitude = asNumber(tags.GPSLongitude);
  if (latitude == null || longitude == null) return null;
  return {
    latitude,
    longitude,
    altitudeMeters: asNumber(tags.GPSAltitude),
  };
}

export function photoFieldsFromExifTool(tags: ExifToolTags | null): {
  width: number | null;
  height: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lensMake: string | null;
  lensModel: string | null;
  software: string | null;
  fNumber: number | null;
  exposureTimeSeconds: number | null;
  iso: number | null;
  exposureBias: number | null;
  focalLengthMm: number | null;
  altitudeMeters: number | null;
} {
  return {
    width:
      asNumber(tags?.ImageWidth) ??
      asNumber(tags?.ExifImageWidth) ??
      asNumber(tags?.SourceImageWidth) ??
      asNumber(tags?.CroppedAreaImageWidthPixels) ??
      asNumber(tags?.FullPanoWidthPixels),
    height:
      asNumber(tags?.ImageHeight) ??
      asNumber(tags?.ExifImageHeight) ??
      asNumber(tags?.SourceImageHeight) ??
      asNumber(tags?.CroppedAreaImageHeightPixels) ??
      asNumber(tags?.FullPanoHeightPixels),
    cameraMake: asString(tags?.Make),
    cameraModel: asString(tags?.Model),
    lensMake: asString(tags?.LensMake),
    lensModel: asString(tags?.LensModel) ?? asString(tags?.LensID),
    software: asString(tags?.Software),
    fNumber: asNumber(tags?.FNumber) ?? asNumber(tags?.Aperture),
    exposureTimeSeconds: asNumber(tags?.ExposureTime),
    iso: asNumber(tags?.ISO) ?? asNumber(tags?.ISOSpeed),
    exposureBias:
      asNumber(tags?.ExposureCompensation) ??
      asNumber(tags?.ExposureBiasValue),
    focalLengthMm: asNumber(tags?.FocalLength),
    altitudeMeters: asNumber(tags?.GPSAltitude),
  };
}

/**
 * DJI Fly / in-drone stitched panoramas carry XMP-GPano equirect tags.
 * Also treat very wide ~2:1 DJI JPEGs as stitches when GPano is missing.
 */
export function isEquirectStitchTags(tags: ExifToolTags | null): boolean {
  if (!tags) return false;
  const projection = asString(tags.ProjectionType)?.toLowerCase();
  if (projection === "equirectangular") return true;
  if (tags.UsePanoramaViewer === true || tags.UsePanoramaViewer === "True") {
    return true;
  }
  if (
    asNumber(tags.FullPanoWidthPixels) != null ||
    asNumber(tags.CroppedAreaImageWidthPixels) != null
  ) {
    return true;
  }

  const width =
    asNumber(tags.ImageWidth) ?? asNumber(tags.ExifImageWidth) ?? 0;
  const height =
    asNumber(tags.ImageHeight) ?? asNumber(tags.ExifImageHeight) ?? 0;
  if (width < 4000 || height < 1000) return false;
  const ratio = width / height;
  const make = (asString(tags.Make) ?? "").toLowerCase();
  const product = (asString(tags.ProductName) ?? "").toLowerCase();
  const djiish =
    make.includes("dji") ||
    make.includes("hasselblad") ||
    product.includes("dji");
  return djiish && ratio >= 1.85 && ratio <= 2.6;
}

export function capturedAtFromExifTool(tags: ExifToolTags | null): Date | null {
  if (!tags) return null;
  const raw =
    tags.DateTimeOriginal ?? tags.CreateDate ?? tags.MediaCreateDate;
  if (typeof raw === "number") {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof raw !== "string" || !raw.trim()) return null;
  const parsed = new Date(
    raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3"),
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
