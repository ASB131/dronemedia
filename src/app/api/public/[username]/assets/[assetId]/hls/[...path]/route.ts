import { Readable } from "node:stream";

import { isSafeHlsPath, videoHlsSegmentKey } from "@/lib/assets/hls";
import { getPublicAssetForUsername } from "@/lib/profiles/queries";
import { getStorageAdapter } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contentTypeFor(fileName: string) {
  if (fileName.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (fileName.endsWith(".ts")) return "video/mp2t";
  return "application/octet-stream";
}

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ username: string; assetId: string; path: string[] }>;
  },
) {
  try {
    const { username, assetId, path: segments } = await context.params;
    if (!segments?.length || !isSafeHlsPath(segments)) {
      return new Response("Not found", { status: 404 });
    }

    const asset = await getPublicAssetForUsername(username, assetId);
    if (!asset || asset.assetType !== "video") {
      return new Response("Not found", { status: 404 });
    }

    const key = videoHlsSegmentKey(asset.userId, asset.id, ...segments);
    const storage = getStorageAdapter();
    const stream = await storage.getStream(key, { tier: "cache" });
    if (!stream) {
      return new Response("Not found", { status: 404 });
    }

    const leaf = segments.at(-1)!;
    return new Response(
      Readable.toWeb(stream as Readable) as unknown as BodyInit,
      {
        headers: {
          "Content-Type": contentTypeFor(leaf),
          "Cache-Control": "public, max-age=3600",
        },
      },
    );
  } catch (error) {
    console.error(error);
    return new Response("Internal server error", { status: 500 });
  }
}
