import {
  parseShutterToSeconds,
  type SrtCameraFields,
} from "@/lib/assets/media-metadata";
import { parseSrtWallClock } from "@/lib/assets/capture-extract";

export type ParsedSrtPoint = {
  lat: number;
  lng: number;
  alt: number;
  startMs: number;
  wallClock: Date | null;
  camera: SrtCameraFields | null;
};

function parseTimestamp(value: string): number {
  const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value.trim());
  if (!match) return 0;
  const [, hours, minutes, seconds, millis] = match;
  return (
    Number(hours) * 3_600_000 +
    Number(minutes) * 60_000 +
    Number(seconds) * 1_000 +
    Number(millis)
  );
}

function isValidCoord(lat: number, lng: number) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ");
}

function asFinite(value: string | undefined) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** DJI-style bracket tags: [iso: 400] [shutter: 1/60.0] [fnum: 6.3] … */
export function extractSrtCamera(payload: string): SrtCameraFields | null {
  const text = stripHtml(payload);
  const iso = asFinite(/\[iso:\s*(-?\d+(?:\.\d+)?)\]/i.exec(text)?.[1]);
  const shutterRaw = /\[shutter:\s*([^\]]+?)\]/i.exec(text)?.[1];
  const fNumber = asFinite(/\[fnum:\s*(-?\d+(?:\.\d+)?)\]/i.exec(text)?.[1]);
  const exposureBias = asFinite(/\[ev:\s*(-?\d+(?:\.\d+)?)\]/i.exec(text)?.[1]);
  const colorTemperatureK = asFinite(
    /\[ct:\s*(-?\d+(?:\.\d+)?)\]/i.exec(text)?.[1],
  );
  const colorMode =
    /\[color_md\s*:\s*([^\]]+?)\]/i.exec(text)?.[1]?.trim() || null;
  const focalLengthMm = asFinite(
    /\[focal_len:\s*(-?\d+(?:\.\d+)?)\]/i.exec(text)?.[1],
  );

  const camera: SrtCameraFields = {
    iso,
    exposureTimeSeconds: parseShutterToSeconds(shutterRaw),
    fNumber,
    exposureBias,
    colorTemperatureK,
    colorMode,
    focalLengthMm,
  };

  if (
    camera.iso == null &&
    camera.exposureTimeSeconds == null &&
    camera.fNumber == null &&
    camera.exposureBias == null &&
    camera.colorTemperatureK == null &&
    !camera.colorMode &&
    camera.focalLengthMm == null
  ) {
    return null;
  }

  return camera;
}

function extractDjiGps(payload: string): {
  lat: number;
  lng: number;
  alt: number;
} | null {
  const text = stripHtml(payload);
  const latMatch = /\[latitude:\s*(-?\d+(?:\.\d+)?)\]/i.exec(text);
  const lngMatch = /\[longitude:\s*(-?\d+(?:\.\d+)?)\]/i.exec(text);
  if (latMatch && lngMatch) {
    const absAlt = /abs_alt:\s*(-?\d+(?:\.\d+)?)/i.exec(text);
    const relAlt = /rel_alt:\s*(-?\d+(?:\.\d+)?)/i.exec(text);
    const plainAlt = /\[altitude:\s*(-?\d+(?:\.\d+)?)\]/i.exec(text);
    const alt = Number(
      absAlt?.[1] ?? relAlt?.[1] ?? plainAlt?.[1] ?? "0",
    );
    return {
      lat: Number(latMatch[1]),
      lng: Number(lngMatch[1]),
      alt,
    };
  }

  // Older DJI: GPS(lat,lng,alt) or GPS: lat, lng, alt
  const gpsParen =
    /GPS\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i.exec(
      text,
    );
  if (gpsParen) {
    return {
      lat: Number(gpsParen[1]),
      lng: Number(gpsParen[2]),
      alt: Number(gpsParen[3]),
    };
  }

  const gpsColon =
    /GPS:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i.exec(
      text,
    );
  if (gpsColon) {
    return {
      lat: Number(gpsColon[1]),
      lng: Number(gpsColon[2]),
      alt: Number(gpsColon[3]),
    };
  }

  return null;
}

function extractAutelGps(payload: string): {
  lat: number;
  lng: number;
  alt: number;
} | null {
  const text = stripHtml(payload);
  // Common Autel-like: [lat: x] [lon: y] [alt: z]
  const bracketLat =
    /\[\s*lat(?:itude)?\s*:\s*(-?\d+(?:\.\d+)?)\s*\]/i.exec(text);
  const bracketLng =
    /\[\s*lon(?:gitude)?\s*:\s*(-?\d+(?:\.\d+)?)\s*\]/i.exec(text);
  const bracketAlt =
    /\[\s*alt(?:itude)?\s*:\s*(-?\d+(?:\.\d+)?)\s*\]/i.exec(text);
  if (bracketLat && bracketLng) {
    return {
      lat: Number(bracketLat[1]),
      lng: Number(bracketLng[1]),
      alt: Number(bracketAlt?.[1] ?? "0"),
    };
  }

  // Attribute style: latitude="x" longitude="y" altitude="z"
  const attrLat =
    /latitude\s*=\s*"(-?\d+(?:\.\d+)?)"/i.exec(text) ??
    /lat\s*=\s*"(-?\d+(?:\.\d+)?)"/i.exec(text);
  const attrLng =
    /longitude\s*=\s*"(-?\d+(?:\.\d+)?)"/i.exec(text) ??
    /lon(?:g)?\s*=\s*"(-?\d+(?:\.\d+)?)"/i.exec(text);
  const attrAlt =
    /altitude\s*=\s*"(-?\d+(?:\.\d+)?)"/i.exec(text) ??
    /alt\s*=\s*"(-?\d+(?:\.\d+)?)"/i.exec(text);
  if (attrLat && attrLng) {
    return {
      lat: Number(attrLat[1]),
      lng: Number(attrLng[1]),
      alt: Number(attrAlt?.[1] ?? "0"),
    };
  }

  return null;
}

function extractGenericGps(payload: string): {
  lat: number;
  lng: number;
  alt: number;
} | null {
  const text = stripHtml(payload);
  const lat =
    /lat(?:itude)?\s*[:=]\s*(-?\d+(?:\.\d+)?)/i.exec(text) ??
    /\[\s*lat(?:itude)?\s*[:=]\s*(-?\d+(?:\.\d+)?)\s*\]/i.exec(text);
  const lng =
    /lon(?:g(?:itude)?)?\s*[:=]\s*(-?\d+(?:\.\d+)?)/i.exec(text) ??
    /\[\s*lon(?:g(?:itude)?)?\s*[:=]\s*(-?\d+(?:\.\d+)?)\s*\]/i.exec(text);
  const alt =
    /alt(?:itude)?\s*[:=]\s*(-?\d+(?:\.\d+)?)/i.exec(text) ??
    /\[\s*alt(?:itude)?\s*[:=]\s*(-?\d+(?:\.\d+)?)\s*\]/i.exec(text);

  if (!lat || !lng) return null;
  return {
    lat: Number(lat[1]),
    lng: Number(lng[1]),
    alt: Number(alt?.[1] ?? "0"),
  };
}

function iterateCueBlocks(
  content: string,
  extract: (
    payload: string,
  ) => { lat: number; lng: number; alt: number } | null,
): ParsedSrtPoint[] {
  const points: ParsedSrtPoint[] = [];
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;

    const timingLine = lines.find((line) => line.includes("-->"));
    if (!timingLine) continue;

    const [startRaw] = timingLine.split("-->").map((part) => part.trim());
    const payload = lines
      .slice(lines.findIndex((line) => line.includes("-->")) + 1)
      .join("\n");
    const gps = extract(payload);
    if (!gps || !isValidCoord(gps.lat, gps.lng)) continue;

    points.push({
      lat: gps.lat,
      lng: gps.lng,
      alt: Number.isFinite(gps.alt) ? gps.alt : 0,
      startMs: parseTimestamp(startRaw ?? "00:00:00,000"),
      wallClock: parseSrtWallClock(payload),
      camera: extractSrtCamera(payload),
    });
  }

  return points;
}

export function detectDji(content: string): boolean {
  return /latitude\s*:/i.test(content) || /GPS\s*\(/i.test(content);
}

export function parseDjiSrt(content: string): ParsedSrtPoint[] {
  return iterateCueBlocks(content, extractDjiGps);
}

export function parseAutelSrt(content: string): ParsedSrtPoint[] {
  return iterateCueBlocks(content, extractAutelGps);
}

export function parseGenericSrt(content: string): ParsedSrtPoint[] {
  return iterateCueBlocks(content, extractGenericGps);
}

export function parseSrt(content: string): {
  parserId: string;
  points: ParsedSrtPoint[];
} {
  const parsers: Array<{
    parserId: string;
    parse: (value: string) => ParsedSrtPoint[];
  }> = [
    { parserId: "dji", parse: parseDjiSrt },
    { parserId: "autel", parse: parseAutelSrt },
    { parserId: "generic", parse: parseGenericSrt },
  ];

  // When DJI markers are present, try DJI first (already ordered that way).
  if (detectDji(content)) {
    const points = parseDjiSrt(content);
    if (points.length > 0) return { parserId: "dji", points };
  }

  for (const entry of parsers) {
    const points = entry.parse(content);
    if (points.length > 0) return { parserId: entry.parserId, points };
  }

  return { parserId: "none", points: [] };
}

export function pickRepresentativeSrtCamera(
  points: ParsedSrtPoint[],
): SrtCameraFields | null {
  return points.find((point) => point.camera)?.camera ?? null;
}
