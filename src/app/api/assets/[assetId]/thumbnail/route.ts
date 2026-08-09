import { getAccessibleAsset } from "@/lib/assets/access";
import { getDeletedAsset } from "@/lib/assets/bin";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { thumbnailCacheKey } from "@/lib/assets/thumbnails";
import { getStorageAdapter } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { assetId } = await context.params;
    const asset =
      (await getAccessibleAsset(session.user.id, assetId)) ??
      (await getDeletedAsset(session.user.id, assetId));

    if (!asset) {
      return new Response("Not found", { status: 404 });
    }

    const storage = getStorageAdapter();
    const key = thumbnailCacheKey(asset.userId, assetId);
    const data = await storage.get(key, { tier: "cache" });

    if (!data) {
      return new Response("Thumbnail not ready", { status: 404 });
    }

    const etag = `"${asset.preferredLutId ?? "none"}-${data.byteLength}"`;
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control":
          "private, max-age=86400, stale-while-revalidate=604800",
        ETag: etag,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
