import { Readable } from "node:stream";

import { getAccessibleAsset } from "@/lib/assets/access";
import {
  effectivePanoramaViewer,
  isEquirectViewerMode,
} from "@/lib/assets/panorama-viewer-mode";
import {
  panoramaDjiStitchedMediaKey,
  panoramaEquirectCacheKey,
  panoramaEquirectViewCacheKey,
} from "@/lib/assets/transcoding";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { buildMediaAssetKey, getStorageAdapter } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { assetId } = await context.params;
    const asset = await getAccessibleAsset(session.user.id, assetId);

    if (!asset) {
      return new Response("Not found", { status: 404 });
    }

    const viewer = effectivePanoramaViewer(asset);
    const isSequencePano =
      asset.assetType === "sequence" && asset.sequenceKind === "panorama";
    const isPhotoEquirect =
      asset.assetType === "photo" && isEquirectViewerMode(viewer);

    if (!isSequencePano && !isPhotoEquirect) {
      return new Response("Not a panorama", { status: 404 });
    }

    const wantFull = new URL(request.url).searchParams.get("full") === "1";
    const storage = getStorageAdapter();
    const ownerId = asset.userId;

    if (isPhotoEquirect) {
      // Prefer DJI stitch key if present (after promote), else main photo file.
      const djiKey = panoramaDjiStitchedMediaKey(ownerId, assetId);
      const mainKey = buildMediaAssetKey(
        ownerId,
        assetId,
        asset.mainFileExt || "jpg",
      );
      const key = (await storage.exists(djiKey, { tier: "media" }))
        ? djiKey
        : mainKey;
      const stream = await storage.getStream(key, { tier: "media" });
      if (!stream) {
        return new Response("Not found", { status: 404 });
      }
      const webStream = Readable.toWeb(
        stream as unknown as Readable,
      ) as ReadableStream;
      return new Response(webStream, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "private, max-age=3600",
        },
      });
    }

    const fullKey = panoramaEquirectCacheKey(ownerId, assetId);
    const viewKey = panoramaEquirectViewCacheKey(ownerId, assetId);

    let key = fullKey;
    if (!wantFull && (await storage.exists(viewKey, { tier: "cache" }))) {
      key = viewKey;
    } else if (!(await storage.exists(fullKey, { tier: "cache" }))) {
      // Fall back to official DJI stitch on media tier while cache builds.
      const djiKey = panoramaDjiStitchedMediaKey(ownerId, assetId);
      if (await storage.exists(djiKey, { tier: "media" })) {
        const stream = await storage.getStream(djiKey, { tier: "media" });
        if (!stream) {
          return Response.json(
            { error: "Panorama preview not ready", status: "stitching" },
            { status: 503 },
          );
        }
        const webStream = Readable.toWeb(
          stream as unknown as Readable,
        ) as ReadableStream;
        return new Response(webStream, {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "private, max-age=60",
          },
        });
      }
      return Response.json(
        { error: "Panorama preview not ready", status: "stitching" },
        { status: 503 },
      );
    }

    const stream = await storage.getStream(key, { tier: "cache" });
    if (!stream) {
      return new Response("Not found", { status: 404 });
    }

    const webStream = Readable.toWeb(
      stream as unknown as Readable,
    ) as ReadableStream;

    return new Response(webStream, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
