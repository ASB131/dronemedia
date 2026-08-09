export type StorageTier = "app" | "cache" | "media";

export interface PutOptions {
  tier?: StorageTier;
  contentType?: string;
}

export interface GetSignedUrlOptions {
  tier?: StorageTier;
  expiresInSeconds?: number;
}

export interface StorageAdapter {
  /** Read entire object into memory. Prefer getStream for large files. */
  get(key: string, options?: { tier?: StorageTier }): Promise<Buffer | null>;

  /** Write object from buffer or readable stream. */
  put(
    key: string,
    data: Buffer | NodeJS.ReadableStream,
    options?: PutOptions,
  ): Promise<void>;

  /** Delete object if it exists. */
  delete(key: string, options?: { tier?: StorageTier }): Promise<void>;

  /** Recursively delete all objects under a key prefix. */
  deletePrefix(
    prefix: string,
    options?: { tier?: StorageTier },
  ): Promise<number>;

  /** Stream object contents. Returns null when the key does not exist. */
  getStream(
    key: string,
    options?: { tier?: StorageTier; start?: number; end?: number },
  ): Promise<NodeJS.ReadableStream | null>;

  /** Byte size of an object, or null when missing. */
  size(
    key: string,
    options?: { tier?: StorageTier },
  ): Promise<number | null>;

  /**
   * Return a URL suitable for direct client access.
   * Local adapter returns an internal API path; S3 adapter returns a presigned URL.
   */
  getSignedUrl(key: string, options?: GetSignedUrlOptions): Promise<string>;

  /** Check whether an object exists. */
  exists(key: string, options?: { tier?: StorageTier }): Promise<boolean>;

  /**
   * Move an object between keys and/or tiers atomically where the backend supports it.
   * Used for chunked upload assembly on CACHE_PATH → final MEDIA_PATH placement.
   */
  move(
    sourceKey: string,
    destKey: string,
    options?: { fromTier?: StorageTier; toTier?: StorageTier },
  ): Promise<void>;

  /** Verify storage backend connectivity and writability. */
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}

/** Canonical media path: {userId}/{assetUuid}/{extension} */
export function buildMediaAssetKey(
  userId: string,
  assetUuid: string,
  extension: string,
): string {
  const normalizedExt = extension.replace(/^\./, "").toLowerCase();
  return `${userId}/${assetUuid}/${normalizedExt}`;
}

/**
 * Ordered sequence frame path:
 * {userId}/{assetUuid}/frames/{index padded 5}.{ext}
 */
export function buildSequenceFrameKey(
  userId: string,
  assetUuid: string,
  frameIndex: number,
  extension: string,
): string {
  const normalizedExt = extension.replace(/^\./, "").toLowerCase();
  const index = String(Math.max(0, frameIndex)).padStart(5, "0");
  return `${userId}/${assetUuid}/frames/${index}.${normalizedExt}`;
}

/** Cache-relative paths for derivatives (thumbnails, HLS, upload staging). */
export function buildCacheKey(...segments: string[]): string {
  return segments.join("/");
}
