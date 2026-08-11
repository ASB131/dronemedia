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
