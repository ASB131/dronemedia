import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import sharp from "sharp";

const execFileAsync = promisify(execFile);

export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

async function runFfmpegFrameExtract(
  inputPath: string,
  framePath: string,
  seekSeconds: number | null,
): Promise<void> {
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  if (seekSeconds != null) {
    args.push("-ss", String(seekSeconds));
  }
  args.push(
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    framePath,
  );
  await execFileAsync("ffmpeg", args, { timeout: 120_000 });
  await fs.access(framePath);
}

async function runFfmpegFrameExtractWithLut(
  inputPath: string,
  framePath: string,
  lutCubePath: string,
  seekSeconds: number | null,
): Promise<void> {
  const lutEscaped = lutCubePath.replace(/\\/g, "/").replace(/:/g, "\\:");
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  if (seekSeconds != null) {
    args.push("-ss", String(seekSeconds));
  }
  args.push(
    "-i",
    inputPath,
    "-vf",
    `lut3d='${lutEscaped}'`,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    framePath,
  );
  await execFileAsync("ffmpeg", args, { timeout: 120_000 });
  await fs.access(framePath);
}

export async function extractVideoThumbnailWebp(
  inputPath: string,
  options?: { maxEdge?: number; quality?: number; lutCubePath?: string | null },
): Promise<Buffer | null> {
  if (!(await ffmpegAvailable())) return null;

  const maxEdge = options?.maxEdge ?? 640;
  const quality = options?.quality ?? 80;
  const lutCubePath = options?.lutCubePath ?? null;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dm-thumb-"));
  const framePath = path.join(tempDir, "frame.jpg");

  try {
    // Prefer ~1s in; fall back to first frame if the seek fails (short clips).
    const extract = lutCubePath
      ? (seek: number | null) =>
          runFfmpegFrameExtractWithLut(inputPath, framePath, lutCubePath, seek)
      : (seek: number | null) =>
          runFfmpegFrameExtract(inputPath, framePath, seek);
    try {
      await extract(1);
    } catch {
      await extract(null);
    }

    // Must await before finally deletes tempDir — returning an unresolved
    // promise lets finally wipe the frame while sharp is still reading it.
    const webp = await sharp(framePath)
      .rotate()
      .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();
    return webp;
  } catch {
    return null;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
export type VideoProbeResult = {
  format?: {
    duration?: string | number;
    bit_rate?: string | number;
    tags?: Record<string, string>;
  };
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    avg_frame_rate?: string;
    bit_rate?: string | number;
  }>;
};

export async function probeVideo(inputPath: string): Promise<VideoProbeResult | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        inputPath,
      ],
      { timeout: 60_000 },
    );
    return JSON.parse(stdout) as VideoProbeResult;
  } catch {
    return null;
  }
}

export async function probeVideoCaptureDate(
  inputPath: string,
): Promise<Date | null> {
  const parsed = await probeVideo(inputPath);
  if (!parsed) return null;
  const tags = parsed.format?.tags ?? {};
  const raw = tags.creation_time ?? tags["com.apple.quicktime.creationdate"];
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}
