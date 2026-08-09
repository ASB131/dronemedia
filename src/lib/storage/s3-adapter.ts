import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";

import type { AppConfig } from "@/lib/config/schema";
import type {
  GetSignedUrlOptions,
  PutOptions,
  StorageAdapter,
  StorageTier,
} from "./types";

function tierPrefix(tier: StorageTier): string {
  return `${tier}/`;
}

function objectKey(tier: StorageTier, key: string): string {
  return `${tierPrefix(tier)}${key.replace(/^\/+/, "")}`;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class S3CompatibleAdapter implements StorageAdapter {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: AppConfig) {
    const s3 = config.storage.s3;
    this.bucket = s3.bucket;
    this.client = new S3Client({
      region: s3.region || "us-east-1",
      endpoint: s3.endpoint || undefined,
      forcePathStyle: s3.forcePathStyle,
      credentials:
        s3.accessKeyId && s3.secretAccessKey
          ? {
              accessKeyId: s3.accessKeyId,
              secretAccessKey: s3.secretAccessKey,
            }
          : undefined,
    });
  }

  async get(
    key: string,
    options?: { tier?: StorageTier },
  ): Promise<Buffer | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: objectKey(options?.tier ?? "media", key),
        }),
      );
      if (!result.Body) return null;
      return streamToBuffer(result.Body as Readable);
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey") return null;
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async put(
    key: string,
    data: Buffer | NodeJS.ReadableStream,
    options?: PutOptions,
  ): Promise<void> {
    const body =
      Buffer.isBuffer(data) ? data : await streamToBuffer(data as Readable);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey(options?.tier ?? "media", key),
        Body: body,
        ContentType: options?.contentType,
      }),
    );
  }

  async delete(key: string, options?: { tier?: StorageTier }): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: objectKey(options?.tier ?? "media", key),
      }),
    );
  }

  async deletePrefix(
    prefix: string,
    options?: { tier?: StorageTier },
  ): Promise<number> {
    const tier = options?.tier ?? "media";
    const fullPrefix = objectKey(tier, prefix.endsWith("/") ? prefix : `${prefix}/`);
    let deleted = 0;
    let token: string | undefined;
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: fullPrefix,
          ContinuationToken: token,
        }),
      );
      const objects = (listed.Contents ?? [])
        .map((item) => item.Key)
        .filter((key): key is string => Boolean(key));
      if (objects.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: {
              Objects: objects.map((Key) => ({ Key })),
            },
          }),
        );
        deleted += objects.length;
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
    return deleted;
  }

  async getStream(
    key: string,
    options?: { tier?: StorageTier; start?: number; end?: number },
  ): Promise<NodeJS.ReadableStream | null> {
    try {
      let range: string | undefined;
      if (options?.start != null || options?.end != null) {
        const start = options.start ?? 0;
        range =
          options.end != null
            ? `bytes=${start}-${options.end}`
            : `bytes=${start}-`;
      }
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: objectKey(options?.tier ?? "media", key),
          Range: range,
        }),
      );
      if (!result.Body) return null;
      return result.Body as Readable;
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey") return null;
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async size(
    key: string,
    options?: { tier?: StorageTier },
  ): Promise<number | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: objectKey(options?.tier ?? "media", key),
        }),
      );
      return typeof result.ContentLength === "number"
        ? result.ContentLength
        : null;
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey") return null;
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async getSignedUrl(
    key: string,
    options?: GetSignedUrlOptions,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey(options?.tier ?? "media", key),
    });
    return getSignedUrl(this.client, command, {
      expiresIn: options?.expiresInSeconds ?? 3600,
    });
  }

  async exists(
    key: string,
    options?: { tier?: StorageTier },
  ): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: objectKey(options?.tier ?? "media", key),
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async move(
    sourceKey: string,
    destKey: string,
    options?: { fromTier?: StorageTier; toTier?: StorageTier },
  ): Promise<void> {
    const data = await this.get(sourceKey, { tier: options?.fromTier });
    if (!data) {
      throw new Error(`S3 move source missing: ${sourceKey}`);
    }
    await this.put(destKey, data, { tier: options?.toTier });
    await this.delete(sourceKey, { tier: options?.fromTier });
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const probeKey = objectKey("app", `.health/${Date.now()}`);
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: probeKey,
          Body: Buffer.from("ok"),
        }),
      );
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: probeKey,
        }),
      );
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : "S3 health failed",
      };
    }
  }
}
