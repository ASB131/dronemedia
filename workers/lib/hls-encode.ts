import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { loadConfig } from "@/lib/config";
import { ffmpegAvailable, probeVideo } from "./ffmpeg";

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

async function probeVideoSize(
  inputPath: string,
): Promise<{ width: number; height: number } | null> {
  const probe = await probeVideo(inputPath);
  const video = probe?.streams?.find((stream) => stream.codec_type === "video");
  if (!video?.width || !video?.height) return null;
  return { width: video.width, height: video.height };
}

function buildLadder(
  maxHeight: number,
  sourceHeight: number,
  preferredHeights: number[],
): number[] {
  const cappedTop = Math.min(sourceHeight, maxHeight);
  const base =
    preferredHeights.length > 0
      ? preferredHeights
      : [1080, 1440, maxHeight, cappedTop];
  const ladder = [...new Set(base)]
    .filter((height) => height > 0 && height <= cappedTop)
    .sort((a, b) => a - b);
  // Always keep at least one rung at or below source.
  if (ladder.length === 0 && cappedTop > 0) return [cappedTop];
  return ladder;
}

/** Encode ABR ladder (≤ maxHeight) and write master `index.m3u8`. */
export async function encodeHlsPackage(
  inputPath: string,
  outputDir: string,
): Promise<{ playlistPath: string; files: string[] }> {
  if (!(await ffmpegAvailable())) {
    throw new Error("ffmpeg not available");
  }

  const config = loadConfig();
  const maxHeight = config.transcoding.proxy.maxHeight;
  const softwareCodec = config.transcoding.proxy.videoCodec;
  const videoCodec = videoCodecFor(config.transcoding.hwAccel, softwareCodec);
  const audioCodec = config.transcoding.proxy.audioCodec;
  const segmentSeconds = config.transcoding.hls.segmentDurationSeconds;
  const playlistType = config.transcoding.hls.playlistType;
  const accel = hwAccelArgs(config.transcoding.hwAccel);

  const source = await probeVideoSize(inputPath);
  const sourceHeight = source?.height ?? maxHeight;
  const ladder = buildLadder(
    maxHeight,
    sourceHeight,
    config.transcoding.hls.heights ?? [1080, 1440],
  );

  await fs.mkdir(outputDir, { recursive: true });

  // Version marker so workers can invalidate older LRF-based packages.
  const masterLines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-DRONE-MEDIA-HLS:3",
  ];
  const encoded: Array<{ height: number; width: number; bandwidth: number }> =
    [];

  for (const height of ladder) {
    const variantDir = path.join(outputDir, String(height));
    await fs.mkdir(variantDir, { recursive: true });
    const playlistPath = path.join(variantDir, "index.m3u8");
    const segmentPattern = path.join(variantDir, "seg_%03d.ts");
    // Distinct bitrates help ABR and make manual switches feel different.
    const crf = height >= 1440 ? 20 : height >= 1080 ? 21 : height >= 720 ? 23 : 25;
    const bitrateEstimate = Math.round(height * height * 2.2);

    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        ...accel,
        "-i",
        inputPath,
        "-vf",
        `scale=-2:${height}`,
        "-c:v",
        videoCodec,
        "-preset",
        "veryfast",
        "-crf",
        String(crf),
        "-c:a",
        audioCodec,
        "-ac",
        "2",
        "-hls_time",
        String(segmentSeconds),
        "-hls_playlist_type",
        playlistType,
        "-hls_segment_filename",
        segmentPattern,
        playlistPath,
      ],
      { timeout: 60 * 60 * 1000 },
    );

    const firstSeg = path.join(variantDir, "seg_000.ts");
    const sized = (await probeVideoSize(firstSeg)) ?? {
      width: Math.round((height * 16) / 9),
      height,
    };
    encoded.push({
      height: sized.height,
      width: sized.width,
      bandwidth: Math.max(bitrateEstimate, sized.height * 1200),
    });

    masterLines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${Math.max(bitrateEstimate, sized.height * 1200)},RESOLUTION=${sized.width}x${sized.height},NAME="${sized.height}p"`,
      `${height}/index.m3u8`,
    );
  }

  // Deduplicate master entries that collapsed to the same output height.
  if (encoded.length > 1) {
    const seen = new Set<number>();
    const filtered = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-DRONE-MEDIA-HLS:3",
    ];
    for (let i = 0; i < encoded.length; i++) {
      const entry = encoded[i]!;
      if (seen.has(entry.height)) continue;
      seen.add(entry.height);
      filtered.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${entry.bandwidth},RESOLUTION=${entry.width}x${entry.height},NAME="${entry.height}p"`,
        `${ladder[i]}/index.m3u8`,
      );
    }
    masterLines.length = 0;
    masterLines.push(...filtered);
  }

  const masterPath = path.join(outputDir, "index.m3u8");
  await fs.writeFile(masterPath, `${masterLines.join("\n")}\n`, "utf8");

  const files: string[] = ["index.m3u8"];
  for (const height of ladder) {
    const variantDir = path.join(outputDir, String(height));
    const entries = await fs.readdir(variantDir);
    for (const entry of entries) {
      files.push(`${height}/${entry}`);
    }
  }

  return { playlistPath: masterPath, files };
}

export async function encodeMp4Proxy(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  if (!(await ffmpegAvailable())) {
    throw new Error("ffmpeg not available");
  }

  const config = loadConfig();
  const maxHeight = config.transcoding.proxy.maxHeight;
  const softwareCodec = config.transcoding.proxy.videoCodec;
  const videoCodec = videoCodecFor(config.transcoding.hwAccel, softwareCodec);
  const audioCodec = config.transcoding.proxy.audioCodec;
  const accel = hwAccelArgs(config.transcoding.hwAccel);

  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      ...accel,
      "-i",
      inputPath,
      "-vf",
      `scale=-2:min(${maxHeight}\\,ih)`,
      "-c:v",
      videoCodec,
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      audioCodec,
      "-movflags",
      "+faststart",
      outputPath,
    ],
    { timeout: 60 * 60 * 1000 },
  );
}
