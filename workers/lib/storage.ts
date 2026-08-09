import { buildMediaAssetKey, buildSequenceFrameKey, getStorageAdapter } from "@/lib/storage";

export async function readMediaFile(
  userId: string,
  assetUuid: string,
  extension: string,
): Promise<Buffer | null> {
  const key = buildMediaAssetKey(userId, assetUuid, extension);
  return getStorageAdapter().get(key, { tier: "media" });
}

export async function streamMediaFile(
  userId: string,
  assetUuid: string,
  extension: string,
): Promise<NodeJS.ReadableStream | null> {
  const key = buildMediaAssetKey(userId, assetUuid, extension);
  return getStorageAdapter().getStream(key, { tier: "media" });
}

export async function readSequenceFrame(
  userId: string,
  assetUuid: string,
  frameIndex: number,
  extension: string,
): Promise<Buffer | null> {
  const key = buildSequenceFrameKey(userId, assetUuid, frameIndex, extension);
  return getStorageAdapter().get(key, { tier: "media" });
}

export async function readSequenceFrameByKey(
  storageKey: string,
): Promise<Buffer | null> {
  return getStorageAdapter().get(storageKey, { tier: "media" });
}
