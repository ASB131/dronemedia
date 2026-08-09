import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getLogger } from "@/lib/logger";

const logger = getLogger().child({ module: "panorama-stitch" });

export type PanoramaStitchMeta = {
  width: number;
  height: number;
  sphere: boolean;
  tileCount: number;
};

function scriptPath() {
  return path.join(process.cwd(), "workers", "scripts", "stitch_panorama.py");
}

async function readSidecarMeta(
  outputPath: string,
): Promise<PanoramaStitchMeta | null> {
  try {
    const raw = await fs.readFile(
      outputPath.replace(/\.jpe?g$/i, ".json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Partial<PanoramaStitchMeta>;
    if (
      typeof parsed.width === "number" &&
      typeof parsed.height === "number" &&
      typeof parsed.sphere === "boolean"
    ) {
      return {
        width: parsed.width,
        height: parsed.height,
        sphere: parsed.sphere,
        tileCount:
          typeof parsed.tileCount === "number" ? parsed.tileCount : 0,
      };
    }
  } catch {
    // fall through
  }
  return null;
}

export async function stitchPanoramaEquirect(params: {
  framePaths: string[];
  outputPath: string;
}): Promise<
  | { ok: true; meta: PanoramaStitchMeta | null }
  | { ok: false; message: string }
> {
  if (params.framePaths.length < 2) {
    return { ok: false, message: "Need at least 2 panorama tiles" };
  }

  const script = scriptPath();
  try {
    await fs.access(script);
  } catch {
    return { ok: false, message: `Stitch script missing at ${script}` };
  }

  await fs.mkdir(path.dirname(params.outputPath), { recursive: true });

  const args = [script, params.outputPath, ...params.framePaths];
  const result = await new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    const child = spawn("python3", args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({
        code: 127,
        stdout,
        stderr: error.message,
      });
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });

  if (result.code === 0) {
    try {
      await fs.access(params.outputPath);
      const meta = await readSidecarMeta(params.outputPath);
      // Keep log short — full per-tile progress can be huge.
      const summary = result.stdout
        .trim()
        .split("\n")
        .filter((line) => !line.startsWith("project "))
        .join(" | ");
      logger.info(
        { outputPath: params.outputPath, detail: summary, meta },
        "Panorama stitch complete",
      );
      return { ok: true, meta };
    } catch {
      return { ok: false, message: "Stitch reported ok but output missing" };
    }
  }

  const message =
    result.stderr.trim() ||
    result.stdout.trim() ||
    `stitch exited with code ${result.code}`;
  logger.warn(
    { code: result.code, message, tmp: os.tmpdir() },
    "Panorama stitch failed",
  );
  return { ok: false, message };
}
