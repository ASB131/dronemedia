import { Readable } from "node:stream";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { getStorageAdapter, type StorageTier } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIERS = new Set<StorageTier>(["app", "cache", "media"]);

export async function GET(request: Request) {
  try {
    const session = await requireApprovedSession();
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    const tierParam = searchParams.get("tier") ?? "media";

    if (!key || key.includes("..") || key.startsWith("/")) {
      return new Response("Invalid key", { status: 400 });
    }

    if (!key.startsWith(`${session.user.id}/`)) {
      return new Response("Forbidden", { status: 403 });
    }

    if (!TIERS.has(tierParam as StorageTier)) {
      return new Response("Invalid tier", { status: 400 });
    }

    const tier = tierParam as StorageTier;
    const storage = getStorageAdapter();
    const stream = await storage.getStream(key, { tier });
    if (!stream) {
      return new Response("Not found", { status: 404 });
    }

    const webStream = Readable.toWeb(
      stream as unknown as Readable,
    ) as ReadableStream;

    return new Response(webStream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
