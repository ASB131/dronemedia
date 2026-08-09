import { createRequire } from "node:module";
import { PassThrough, Readable } from "node:stream";

import { z } from "zod";

import { getOwnedAsset } from "@/lib/assets/access";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { buildMediaAssetKey, getStorageAdapter } from "@/lib/storage";

const require = createRequire(import.meta.url);
// archiver CJS default export
const archiver = require("archiver") as (
  format: string,
  options?: { zlib?: { level?: number } },
) => {
  on(event: string, cb: (error: Error) => void): void;
  pipe(stream: PassThrough): void;
  append(
    data: NodeJS.ReadableStream | Buffer,
    options: { name: string },
  ): void;
  finalize(): Promise<void>;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cap multi-asset zip payload so the app cannot pin tens of GB. */
const MAX_ZIP_BYTES = 8 * 1024 * 1024 * 1024;

const bodySchema = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(50),
});

export async function POST(request: Request) {
  try {
    const session = await requireApprovedSession();
    const body = bodySchema.parse(await request.json());
    const storage = getStorageAdapter();

    const entries: Array<{
      name: string;
      key: string;
      size: number;
    }> = [];
    let totalBytes = 0;

    for (const assetId of body.assetIds) {
      const asset = await getOwnedAsset(session.user.id, assetId);
      if (!asset) continue;
      const key = buildMediaAssetKey(
        session.user.id,
        assetId,
        asset.mainFileExt,
      );
      const size = await storage.size(key, { tier: "media" });
      if (size == null) continue;
      totalBytes += size;
      if (totalBytes > MAX_ZIP_BYTES) {
        return Response.json(
          {
            error: `Zip would exceed ${MAX_ZIP_BYTES / (1024 * 1024 * 1024)}GB; select fewer or smaller assets.`,
          },
          { status: 413 },
        );
      }
      entries.push({
        name: `${asset.displayName}.${asset.mainFileExt}`,
        key,
        size,
      });
    }

    if (entries.length === 0) {
      return new Response("No files", { status: 404 });
    }

    const pass = new PassThrough();
    const archive = archiver("zip", { zlib: { level: 5 } });
    archive.on("error", (error: Error) => {
      pass.destroy(error);
    });
    archive.pipe(pass);

    void (async () => {
      for (const entry of entries) {
        const stream = await storage.getStream(entry.key, { tier: "media" });
        if (!stream) continue;
        archive.append(stream, { name: entry.name });
      }
      await archive.finalize();
    })().catch((error: Error) => {
      pass.destroy(error);
    });

    return new Response(Readable.toWeb(pass) as ReadableStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="drone-media-export.zip"',
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
