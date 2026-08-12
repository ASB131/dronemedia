import fs from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "@/lib/config";

export type MediaDiskStats = {
  diskUsedBytes: number;
  diskTotalBytes: number;
  mediaPath: string;
};

/** Used / capacity for the filesystem that holds the media bind mount. */
export async function getMediaDiskStats(): Promise<MediaDiskStats | null> {
  const config = loadConfig();
  const mediaPath = path.resolve(
    process.env.MEDIA_PATH ?? config.storage.mediaPath,
  );

  try {
    await fs.mkdir(mediaPath, { recursive: true });
    const stats = await fs.statfs(mediaPath);
    const blockSize = Number(stats.bsize);
    const total = blockSize * Number(stats.blocks);
    const free = blockSize * Number(stats.bavail);
    if (!Number.isFinite(total) || total <= 0) return null;
    return {
      mediaPath,
      diskTotalBytes: total,
      diskUsedBytes: Math.max(0, total - free),
    };
  } catch {
    return null;
  }
}
