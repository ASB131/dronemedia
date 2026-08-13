import { getPublicAssetForUsername } from "@/lib/profiles/queries";
import { thumbnailCacheKey } from "@/lib/assets/thumbnails";
import { getStorageAdapter } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ username: string; assetId: string }> },
) {
  try {
    const { username, assetId } = await context.params;
    const asset = await getPublicAssetForUsername(username, assetId);
    if (!asset) {
      return new Response("Not found", { status: 404 });
    }

    const storage = getStorageAdapter();
    const key = thumbnailCacheKey(asset.userId, asset.id);
    const data = await storage.get(key, { tier: "cache" });
    if (!data) {
      return new Response("Thumbnail not ready", { status: 404 });
    }

    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=3600",
        ETag: `"${asset.updatedAt?.getTime?.() ?? 0}-${data.byteLength}"`,
      },
    });
  } catch (error) {
    console.error(error);
    return new Response("Internal server error", { status: 500 });
  }
}
