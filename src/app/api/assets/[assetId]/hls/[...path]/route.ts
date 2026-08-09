import { Readable } from "node:stream";

import { getAccessibleAsset } from "@/lib/assets/access";
import { isSafeHlsPath, videoHlsSegmentKey } from "@/lib/assets/hls";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";
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
  context: { params: Promise<{ assetId: string; path: string[] }> },
) {
  try {
    const session = await requireApprovedSession();
    const { assetId, path: segments } = await context.params;

    if (!segments?.length || !isSafeHlsPath(segments)) {
      return new Response("Not found", { status: 404 });
    }

    const asset = await getAccessibleAsset(session.user.id, assetId);
    if (!asset || asset.assetType !== "video") {
      return new Response("Not found", { status: 404 });
    }

    const key = videoHlsSegmentKey(asset.userId, assetId, ...segments);
    const storage = getStorageAdapter();
    const stream = await storage.getStream(key, { tier: "cache" });
    if (!stream) {
      return new Response("Not found", { status: 404 });
    }

    const leaf = segments.at(-1)!;
    const webStream = Readable.toWeb(
      stream as unknown as Readable,
    ) as ReadableStream;

    return new Response(webStream, {
      headers: {
        "Content-Type": contentTypeFor(leaf),
        "Cache-Control": leaf.endsWith(".m3u8")
          ? "private, max-age=60"
          : "private, max-age=86400",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
