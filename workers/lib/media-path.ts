import path from "node:path";

import { loadConfig } from "@/lib/config";
import { buildMediaAssetKey, buildSequenceFrameKey } from "@/lib/storage";

/** Absolute host/container path for a media object (local adapter). */
export function localMediaPath(
  userId: string,
  assetId: string,
  extension: string,
): string {
  const config = loadConfig();
  const key = buildMediaAssetKey(userId, assetId, extension);
  return path.join(config.storage.mediaPath, ...key.split("/"));
}

export function localSequenceFramePath(
  userId: string,
  assetId: string,
  frameIndex: number,
  extension: string,
): string {
  const config = loadConfig();
  const key = buildSequenceFrameKey(userId, assetId, frameIndex, extension);
  return path.join(config.storage.mediaPath, ...key.split("/"));
}
