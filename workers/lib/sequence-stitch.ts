import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { loadConfig } from "@/lib/config";
import { ffmpegAvailable } from "./ffmpeg";

const execFileAsync = promisify(execFile);

function hwAccelArgs(hwAccel: string): string[] {
  if (hwAccel === "nvenc") return ["-hwaccel", "cuda"];
  if (hwAccel === "qsv") return ["-hwaccel", "qsv"];
  if (hwAccel === "vaapi") return ["-hwaccel", "vaapi"];
  return [];
}

function videoCodecFor(hwAccel: string, softwareCodec: string): string {
  if (hwAccel === "nvenc") return "h264_nvenc";
  if (hwAccel === "qsv") return "h264_qsv";
  if (hwAccel === "vaapi") return "h264_vaapi";
  return softwareCodec;
}

/**
 * Stitch ordered JPEG/PNG frames into an H.264 MP4.
 * quality: proxy (scaled) | fullres (source resolution, high CRF).
 */
export async function stitchSequenceMp4(params: {
  framePaths: string[];
  outputPath: string;
  quality: "proxy" | "fullres";
  /** Overrides config.transcoding.sequences.fps when set. */
  fps?: number;
}): Promise<void> {
  if (!(await ffmpegAvailable())) {
    throw new Error("ffmpeg not available");
  }
  if (params.framePaths.length === 0) {
    throw new Error("No frames to stitch");
  }

  const config = loadConfig();
  const fps =
    typeof params.fps === "number" && params.fps > 0
      ? params.fps
      : config.transcoding.sequences.fps;
  const softwareCodec = config.transcoding.proxy.videoCodec;
  const videoCodec = videoCodecFor(config.transcoding.hwAccel, softwareCodec);
  const accel = hwAccelArgs(config.transcoding.hwAccel);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dm-seq-frames-"));
  const pattern = path.join(tempDir, "frame_%05d.jpg");

  try {
    for (let i = 0; i < params.framePaths.length; i++) {
      const dest = path.join(
        tempDir,
        `frame_${String(i).padStart(5, "0")}.jpg`,
      );
      await fs.copyFile(params.framePaths[i]!, dest);
    }

    const args = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      ...accel,
      "-framerate",
      String(fps),
      "-i",
      pattern,
    ];

    if (params.quality === "proxy") {
      const maxHeight = config.transcoding.proxy.maxHeight;
      args.push(
        "-vf",
        `scale=-2:min(${maxHeight}\\,ih)`,
        "-c:v",
        videoCodec,
        "-preset",
        "veryfast",
        "-crf",
        "23",
      );
    } else {
      args.push(
        "-c:v",
        videoCodec,
        "-preset",
        config.transcoding.sequences.fullResPreset,
        "-crf",
        String(config.transcoding.sequences.fullResCrf),
      );
    }

    args.push("-an", "-movflags", "+faststart", params.outputPath);

    await execFileAsync("ffmpeg", args, { timeout: 2 * 60 * 60 * 1000 });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
