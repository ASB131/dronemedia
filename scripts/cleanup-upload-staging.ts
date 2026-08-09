#!/usr/bin/env tsx
/**
 * Reclaim bloated cache/uploads staging (chunks + assembled leftovers).
 * Does not touch media/ library files.
 *
 * Usage: npx tsx scripts/cleanup-upload-staging.ts
 */
import { loadConfig } from "@/lib/config";
import { closeDbPools } from "@/lib/db";
import { cleanupOrphanUploads } from "@/lib/upload/orphan-cleanup";

async function main() {
  loadConfig();
  const result = await cleanupOrphanUploads();
  console.log("[cleanup-upload-staging]", result);
  await closeDbPools();
}

main().catch(async (error) => {
  console.error("[cleanup-upload-staging] Failed:", error);
  await closeDbPools().catch(() => undefined);
  process.exit(1);
});
