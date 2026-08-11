/** How an equirect / photo should be displayed. User override wins over auto-detect. */
export type PanoramaViewerMode = "photo" | "180" | "360";

export type PhotoMediaMetadata = {
  kind: "photo";
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
  /** Stitched panorama canvas size (all tiles combined). */
  panoramaWidth: number | null;
  panoramaHeight: number | null;
  /** True when the stitch covers a full sphere (includes nadir). */
  panoramaSphere: boolean | null;
  /**
   * Explicit viewer mode. When null, derive from panoramaSphere / asset type.
   * User toggles set this; auto-detect only fills when still null.
   */
  panoramaViewer: PanoramaViewerMode | null;
  /**
   * Geographic heading (degrees, 0–360) of the equirect image center when
   * known from GPano/DJI tags. Null when unavailable — never invent.
   */
  panoramaPoseHeadingDegrees: number | null;
};

export type VideoMediaMetadata = {
  kind: "video";
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  /** Bits per second from the container. */
  bitrateBps: number | null;
  frameRate: number | null;
  /** Camera exposure fields — typically filled from DJI/Autel SRT. */
  iso: number | null;
  exposureTimeSeconds: number | null;
  fNumber: number | null;
  exposureBias: number | null;
  colorTemperatureK: number | null;
  colorMode: string | null;
  focalLengthMm: number | null;
};

export type MediaMetadata = PhotoMediaMetadata | VideoMediaMetadata;

export function formatExposureTime(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds >= 1) {
    return `${Number(seconds.toFixed(2))} s`;
  }
  const denom = Math.round(1 / seconds);
  if (denom > 0 && Math.abs(1 / denom - seconds) / seconds < 0.05) {
    return `1/${denom} s`;
  }
  return `${seconds.toPrecision(3)} s`;
}

export function formatFNumber(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `f/${Number(value.toFixed(1))}`;
}

export function formatBitrateMBps(bitrateBps: number | null): string {
  if (bitrateBps == null || !Number.isFinite(bitrateBps) || bitrateBps <= 0) {
    return "—";
  }
  // bps → MB/s (megabytes per second)
  const mbps = bitrateBps / 8 / 1_000_000;
  return `${mbps.toFixed(mbps >= 10 ? 1 : 2)} MB/s`;
}

export function formatFrameRate(fps: number | null): string {
  if (fps == null || !Number.isFinite(fps) || fps <= 0) return "—";
  return `${Number(fps.toFixed(fps % 1 === 0 ? 0 : 2))} fps`;
}

export function formatDurationClock(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatDimensions(
  width: number | null,
  height: number | null,
): string {
  if (width == null || height == null) return "—";
  return `${width} × ${height}`;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseFrameRate(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw !== "string" || !raw.includes("/")) {
    return asFiniteNumber(raw);
  }
  const [num, den] = raw.split("/").map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  const fps = num / den;
  return Number.isFinite(fps) && fps > 0 ? fps : null;
}

export function photoMetadataFromExif(
  exif: Record<string, unknown> | null | undefined,
): PhotoMediaMetadata {
  const width =
    asFiniteNumber(exif?.ExifImageWidth) ??
    asFiniteNumber(exif?.ImageWidth) ??
    asFiniteNumber(exif?.PixelXDimension);
  const height =
    asFiniteNumber(exif?.ExifImageHeight) ??
    asFiniteNumber(exif?.ImageHeight) ??
    asFiniteNumber(exif?.PixelYDimension);

  const iso =
    asFiniteNumber(exif?.ISO) ??
    asFiniteNumber(exif?.ISOSpeedRatings) ??
    asFiniteNumber(exif?.PhotographicSensitivity);

  return {
    kind: "photo",
    width,
    height,
    cameraMake: asTrimmedString(exif?.Make),
    cameraModel: asTrimmedString(exif?.Model),
    lensMake: asTrimmedString(exif?.LensMake),
    lensModel:
      asTrimmedString(exif?.LensModel) ?? asTrimmedString(exif?.LensID),
    software: asTrimmedString(exif?.Software),
    fNumber: asFiniteNumber(exif?.FNumber) ?? asFiniteNumber(exif?.ApertureValue),
    exposureTimeSeconds: asFiniteNumber(exif?.ExposureTime),
    iso,
    exposureBias: asFiniteNumber(exif?.ExposureBiasValue),
    focalLengthMm: asFiniteNumber(exif?.FocalLength),
    altitudeMeters: asFiniteNumber(exif?.GPSAltitude),
    panoramaWidth: null,
    panoramaHeight: null,
    panoramaSphere: null,
    panoramaViewer: null,
    panoramaPoseHeadingDegrees: null,
  };
}

/** Prefer non-null fields from `primary`, fill gaps from `fallback`. */
export function mergePhotoMetadata(
  primary: PhotoMediaMetadata,
  fallback: Partial<Omit<PhotoMediaMetadata, "kind">> | null | undefined,
): PhotoMediaMetadata {
  if (!fallback) return primary;
  return {
    kind: "photo",
    width: primary.width ?? fallback.width ?? null,
    height: primary.height ?? fallback.height ?? null,
    cameraMake: primary.cameraMake ?? fallback.cameraMake ?? null,
    cameraModel: primary.cameraModel ?? fallback.cameraModel ?? null,
    lensMake: primary.lensMake ?? fallback.lensMake ?? null,
    lensModel: primary.lensModel ?? fallback.lensModel ?? null,
    software: primary.software ?? fallback.software ?? null,
    fNumber: primary.fNumber ?? fallback.fNumber ?? null,
    exposureTimeSeconds:
      primary.exposureTimeSeconds ?? fallback.exposureTimeSeconds ?? null,
    iso: primary.iso ?? fallback.iso ?? null,
    exposureBias: primary.exposureBias ?? fallback.exposureBias ?? null,
    focalLengthMm: primary.focalLengthMm ?? fallback.focalLengthMm ?? null,
    altitudeMeters: primary.altitudeMeters ?? fallback.altitudeMeters ?? null,
    panoramaWidth: primary.panoramaWidth ?? fallback.panoramaWidth ?? null,
    panoramaHeight: primary.panoramaHeight ?? fallback.panoramaHeight ?? null,
    panoramaSphere: primary.panoramaSphere ?? fallback.panoramaSphere ?? null,
    panoramaViewer: primary.panoramaViewer ?? fallback.panoramaViewer ?? null,
    panoramaPoseHeadingDegrees:
      primary.panoramaPoseHeadingDegrees ??
      fallback.panoramaPoseHeadingDegrees ??
      null,
  };
}

export function isPanoramaViewerMode(
  value: unknown,
): value is PanoramaViewerMode {
  return value === "photo" || value === "180" || value === "360";
}

/**
 * Apply a user (or auto) viewer mode and keep panoramaSphere in sync.
 * Does not clear panorama canvas dimensions when switching to photo.
 */
export function withPanoramaViewerMode(
  meta: PhotoMediaMetadata,
  mode: PanoramaViewerMode,
): PhotoMediaMetadata {
  return {
    ...meta,
    panoramaViewer: mode,
    panoramaSphere:
      mode === "photo" ? meta.panoramaSphere : mode === "360",
  };
}

/** Set auto-detected viewer mode only when the user has not chosen one. */
export function withAutoPanoramaViewer(
  meta: PhotoMediaMetadata,
  mode: PanoramaViewerMode,
): PhotoMediaMetadata {
  if (meta.panoramaViewer != null) return meta;
  return withPanoramaViewerMode(meta, mode);
}

export function videoMetadataFromProbe(probe: {
  format?: {
    duration?: string | number;
    bit_rate?: string | number;
  };
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    avg_frame_rate?: string;
    bit_rate?: string | number;
  }>;
}): VideoMediaMetadata {
  const videoStream =
    probe.streams?.find((stream) => stream.codec_type === "video") ?? null;

  const durationSeconds = asFiniteNumber(probe.format?.duration);
  const bitrateBps =
    asFiniteNumber(probe.format?.bit_rate) ??
    asFiniteNumber(videoStream?.bit_rate);

  return {
    kind: "video",
    durationSeconds,
    width: asFiniteNumber(videoStream?.width),
    height: asFiniteNumber(videoStream?.height),
    bitrateBps,
    frameRate:
      parseFrameRate(videoStream?.avg_frame_rate) ??
      parseFrameRate(videoStream?.r_frame_rate),
    iso: null,
    exposureTimeSeconds: null,
    fNumber: null,
    exposureBias: null,
    colorTemperatureK: null,
    colorMode: null,
    focalLengthMm: null,
  };
}

/** Prefer non-null fields from `primary`, fill gaps from `fallback`. */
export function mergeVideoMetadata(
  primary: VideoMediaMetadata,
  fallback: Partial<Omit<VideoMediaMetadata, "kind">> | null | undefined,
): VideoMediaMetadata {
  if (!fallback) return primary;
  return {
    kind: "video",
    durationSeconds:
      primary.durationSeconds ?? fallback.durationSeconds ?? null,
    width: primary.width ?? fallback.width ?? null,
    height: primary.height ?? fallback.height ?? null,
    bitrateBps: primary.bitrateBps ?? fallback.bitrateBps ?? null,
    frameRate: primary.frameRate ?? fallback.frameRate ?? null,
    iso: primary.iso ?? fallback.iso ?? null,
    exposureTimeSeconds:
      primary.exposureTimeSeconds ?? fallback.exposureTimeSeconds ?? null,
    fNumber: primary.fNumber ?? fallback.fNumber ?? null,
    exposureBias: primary.exposureBias ?? fallback.exposureBias ?? null,
    colorTemperatureK:
      primary.colorTemperatureK ?? fallback.colorTemperatureK ?? null,
    colorMode: primary.colorMode ?? fallback.colorMode ?? null,
    focalLengthMm: primary.focalLengthMm ?? fallback.focalLengthMm ?? null,
  };
}

export type SrtCameraFields = {
  iso: number | null;
  exposureTimeSeconds: number | null;
  fNumber: number | null;
  exposureBias: number | null;
  colorTemperatureK: number | null;
  colorMode: string | null;
  focalLengthMm: number | null;
};

export function hasSrtCameraFields(fields: SrtCameraFields | null | undefined) {
  if (!fields) return false;
  return (
    fields.iso != null ||
    fields.exposureTimeSeconds != null ||
    fields.fNumber != null ||
    fields.exposureBias != null ||
    fields.colorTemperatureK != null ||
    Boolean(fields.colorMode) ||
    fields.focalLengthMm != null
  );
}

export function parseShutterToSeconds(raw: string | null | undefined) {
  if (!raw) return null;
  const trimmed = raw.trim();
  const fraction = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(trimmed);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (
      Number.isFinite(numerator) &&
      Number.isFinite(denominator) &&
      denominator !== 0
    ) {
      return numerator / denominator;
    }
  }
  return asFiniteNumber(trimmed);
}
