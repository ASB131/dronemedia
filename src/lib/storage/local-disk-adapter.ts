import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import type { AppConfig } from "@/lib/config/schema";
import type {
  GetSignedUrlOptions,
  PutOptions,
  StorageAdapter,
  StorageTier,
} from "./types";

function tierToRoot(config: AppConfig, tier: StorageTier): string {
  switch (tier) {
    case "app":
      return config.storage.appDataPath;
    case "cache":
      return config.storage.cachePath;
    case "media":
      return config.storage.mediaPath;
  }
}

function resolvePath(root: string, key: string): string {
  const normalized = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, "");
  const full = path.join(root, normalized);
  const resolvedRoot = path.resolve(root);
  if (!path.resolve(full).startsWith(resolvedRoot + path.sep) && path.resolve(full) !== resolvedRoot) {
    throw new Error(`Storage key escapes root: ${key}`);
  }
  return full;
}

export class LocalDiskAdapter implements StorageAdapter {
  constructor(private readonly config: AppConfig) {}

  private root(tier: StorageTier = "media"): string {
    return tierToRoot(this.config, tier);
  }

  async get(key: string, options?: { tier?: StorageTier }): Promise<Buffer | null> {
    const filePath = resolvePath(this.root(options?.tier), key);
    try {
      return await fsp.readFile(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
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
    const filePath = resolvePath(this.root(options?.tier ?? "media"), key);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });

    if (Buffer.isBuffer(data)) {
      await fsp.writeFile(filePath, data);
      return;
    }

    await pipeline(data, fs.createWriteStream(filePath));
  }

  async delete(key: string, options?: { tier?: StorageTier }): Promise<void> {
    const filePath = resolvePath(this.root(options?.tier), key);
    try {
      await fsp.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async deletePrefix(
    prefix: string,
    options?: { tier?: StorageTier },
  ): Promise<number> {
    const dirPath = resolvePath(this.root(options?.tier ?? "cache"), prefix);
    try {
      await fsp.rm(dirPath, { recursive: true, force: true });
      return 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return 0;
      }
      throw error;
    }
  }

  async getStream(
    key: string,
    options?: { tier?: StorageTier; start?: number; end?: number },
  ): Promise<NodeJS.ReadableStream | null> {
    const filePath = resolvePath(this.root(options?.tier), key);
    try {
      await fsp.access(filePath, fs.constants.R_OK);
      const start = options?.start;
      const end = options?.end;
      if (start != null || end != null) {
        return fs.createReadStream(filePath, {
          start: start ?? 0,
          end,
        });
      }
      return fs.createReadStream(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async size(
    key: string,
    options?: { tier?: StorageTier },
  ): Promise<number | null> {
    const filePath = resolvePath(this.root(options?.tier), key);
    try {
      const stat = await fsp.stat(filePath);
      return stat.size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async getSignedUrl(key: string, options?: GetSignedUrlOptions): Promise<string> {
    const tier = options?.tier ?? "media";
    const params = new URLSearchParams({ key, tier });
    return `/api/storage/stream?${params.toString()}`;
  }

  async exists(key: string, options?: { tier?: StorageTier }): Promise<boolean> {
    const filePath = resolvePath(this.root(options?.tier), key);
    try {
      await fsp.access(filePath, fs.constants.F_OK);
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
    const fromTier = options?.fromTier ?? "cache";
    const toTier = options?.toTier ?? "media";
    const sourcePath = resolvePath(this.root(fromTier), sourceKey);
    const destPath = resolvePath(this.root(toTier), destKey);

    await fsp.mkdir(path.dirname(destPath), { recursive: true });

    try {
      await fsp.rename(sourcePath, destPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EXDEV") {
        await pipeline(
          fs.createReadStream(sourcePath),
          fs.createWriteStream(destPath),
        );
        await fsp.unlink(sourcePath);
        return;
      }
      throw error;
    }
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    const tiers: StorageTier[] = ["app", "cache", "media"];
    for (const tier of tiers) {
      const root = this.root(tier);
      try {
        await fsp.mkdir(root, { recursive: true });
        const probe = path.join(root, ".healthcheck");
        await fsp.writeFile(probe, "ok", "utf8");
        await fsp.unlink(probe);
      } catch (error) {
        return {
          ok: false,
          detail: `Tier "${tier}" at ${root}: ${(error as Error).message}`,
        };
      }
    }
    return { ok: true };
  }
}
