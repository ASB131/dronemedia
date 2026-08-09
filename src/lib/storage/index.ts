import { loadConfig } from "@/lib/config";
import { LocalDiskAdapter } from "./local-disk-adapter";
import { S3CompatibleAdapter } from "./s3-adapter";
import type { StorageAdapter } from "./types";

let adapterInstance: StorageAdapter | null = null;

export function getStorageAdapter(): StorageAdapter {
  if (adapterInstance) {
    return adapterInstance;
  }

  const config = loadConfig();

  switch (config.storage.adapter) {
    case "local":
      adapterInstance = new LocalDiskAdapter(config);
      break;
    case "s3":
      adapterInstance = new S3CompatibleAdapter(config);
      break;
    default:
      throw new Error(`Unknown storage adapter: ${config.storage.adapter}`);
  }

  return adapterInstance;
}

export * from "./types";
export { LocalDiskAdapter } from "./local-disk-adapter";
export { S3CompatibleAdapter } from "./s3-adapter";
