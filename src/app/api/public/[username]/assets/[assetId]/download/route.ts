import { Readable } from "node:stream";

import { mimeTypeForExtension } from "@/lib/assets/media-mime";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { getPublicAssetForUsername } from "@/lib/profiles/queries";
import { buildMediaAssetKey, getStorageAdapter } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeBaseName(displayName: string) {
  return displayName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "asset";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ username: string; assetId: string }> },
) {
  try {
    await requireApprovedSession();
    const { username, assetId } = await context.params;
    const asset = await getPublicAssetForUsername(username, assetId);
    if (!asset) {
      return new Response("Not found", { status: 404 });
    }

    const storage = getStorageAdapter();
    const mainExt = asset.mainFileExt.replace(/^\./, "").toLowerCase();
    const key = buildMediaAssetKey(asset.userId, asset.id, mainExt);
    const stream = await storage.getStream(key, { tier: "media" });
    if (!stream) {
      return new Response("Media not found", { status: 404 });
    }

    const filename = `${safeBaseName(asset.displayName)}.${mainExt}`;
    return new Response(
      Readable.toWeb(stream as unknown as Readable) as unknown as BodyInit,
      {
        headers: {
          "Content-Type": mimeTypeForExtension(mainExt),
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    return jsonError(error);
  }
}
