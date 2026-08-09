import sharp from "sharp";

import { photoWebPreviewCacheKey } from "@/lib/assets/thumbnails";
import { loadConfig } from "@/lib/config";
import { buildMediaAssetKey, getStorageAdapter } from "@/lib/storage";

/** Build (or return existing) cache web preview for in-app photo viewing. */
export async function ensurePhotoWebPreview(
  userId: string,
  assetId: string,
  mainFileExt: string,
): Promise<{ key: string; contentType: string } | null> {
  const storage = getStorageAdapter();
  const previewKey = photoWebPreviewCacheKey(userId, assetId);
  if (await storage.exists(previewKey, { tier: "cache" })) {
    return { key: previewKey, contentType: "image/webp" };
  }

  const mediaKey = buildMediaAssetKey(userId, assetId, mainFileExt);
  const original = await storage.get(mediaKey, { tier: "media" });
  if (!original) return null;

  const config = loadConfig();
  const webp = await sharp(original)
    .rotate()
    .resize(config.images.webMaxEdge, config.images.webMaxEdge, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: config.images.webQuality })
    .toBuffer();

  await storage.put(previewKey, webp, {
    tier: "cache",
    contentType: "image/webp",
  });
  return { key: previewKey, contentType: "image/webp" };
}
