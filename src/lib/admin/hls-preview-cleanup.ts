import { and, inArray, isNull } from "drizzle-orm";

import {
  videoHlsPlaylistKey,
  videoHlsVariantPrefix,
} from "@/lib/assets/hls";
import { getWebDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import {
  isHlsPreviewHeight,
  type HlsPreviewHeight,
} from "@/lib/playback/resolution";
import { getStorageAdapter } from "@/lib/storage";

/**
 * Drop one STREAM-INF / URI pair for `height` from a master playlist.
 * Returns null when the playlist does not need rewriting.
 */
export function rewriteMasterPlaylistWithoutHeight(
  masterText: string,
  height: number,
): string | null {
  const lines = masterText.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1];
    const nextTrim = typeof next === "string" ? next.trim() : "";
    if (
      line.startsWith("#EXT-X-STREAM-INF:") &&
      (nextTrim === `${height}/index.m3u8` || nextTrim.startsWith(`${height}/`))
    ) {
      i += 1;
      changed = true;
      continue;
    }
    const trim = line.trim();
    if (trim === `${height}/index.m3u8`) {
      changed = true;
      continue;
    }
    out.push(line);
  }
  if (!changed) return null;
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return `${out.join("\n")}\n`;
}

/** Parse present ABR folder heights from a master playlist. */
export function parseHlsMasterHeights(masterText: string): number[] {
  const heights: number[] = [];
  const lines = masterText.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const match = /^(\d+)\/index\.m3u8\s*$/.exec(line.trim());
    if (!match) continue;
    const height = Number(match[1]);
    if (Number.isFinite(height) && height > 0) heights.push(height);
  }
  return [...new Set(heights)].sort((a, b) => a - b);
}

/**
 * Delete every asset's HLS variant folder for `height` and rewrite masters.
 * Does not touch source media or other resolutions.
 */
export async function purgeHlsPreviewHeight(
  height: HlsPreviewHeight,
): Promise<{
  assetsTouched: number;
  variantsDeleted: number;
  playlistsRewritten: number;
}> {
  if (!isHlsPreviewHeight(height)) {
    throw new Error(`Unsupported HLS preview height: ${height}`);
  }

  const db = getWebDb();
  const storage = getStorageAdapter();
  const rows = await db
    .select({
      id: assets.id,
      userId: assets.userId,
      sequenceKind: assets.sequenceKind,
    })
    .from(assets)
    .where(
      and(
        isNull(assets.deletedAt),
        inArray(assets.assetType, ["video", "sequence"]),
      ),
    );

  let variantsDeleted = 0;
  let playlistsRewritten = 0;
  let assetsTouched = 0;

  for (const row of rows) {
    if (row.sequenceKind === "panorama") continue;

    const variantPrefix = videoHlsVariantPrefix(row.userId, row.id, height);
    const deleted = await storage.deletePrefix(variantPrefix, {
      tier: "cache",
    });
    if (deleted > 0) variantsDeleted += 1;

    const playlistKey = videoHlsPlaylistKey(row.userId, row.id);
    const raw = await storage.get(playlistKey, { tier: "cache" });
    if (!raw) {
      if (deleted > 0) assetsTouched += 1;
      continue;
    }
    const text = Buffer.from(raw).toString("utf8");
    const next = rewriteMasterPlaylistWithoutHeight(text, height);
    if (next) {
      await storage.put(playlistKey, Buffer.from(next, "utf8"), {
        tier: "cache",
        contentType: "application/vnd.apple.mpegurl",
      });
      playlistsRewritten += 1;
      assetsTouched += 1;
    } else if (deleted > 0) {
      assetsTouched += 1;
    }
  }

  return { assetsTouched, variantsDeleted, playlistsRewritten };
}
