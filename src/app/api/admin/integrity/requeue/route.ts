import { NextResponse } from "next/server";
import { and, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { jsonError, requireAdminSession } from "@/lib/api/auth";
import { getWebDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import {
  getThumbnailsQueue,
  getWebTranscodingQueue,
} from "@/lib/jobs/queues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(100),
  job: z.enum(["thumbnails", "hls"]),
});

export async function POST(request: Request) {
  try {
    await requireAdminSession();
    const body = bodySchema.parse(await request.json());
    const assetIds = [...new Set(body.assetIds)];
    const db = getWebDb();
    const rows = await db
      .select({
        id: assets.id,
        userId: assets.userId,
        assetType: assets.assetType,
        sequenceKind: assets.sequenceKind,
      })
      .from(assets)
      .where(and(inArray(assets.id, assetIds), isNull(assets.deletedAt)));

    const eligible =
      body.job === "hls"
        ? rows.filter(
            (asset) =>
              asset.assetType === "video" ||
              (asset.assetType === "sequence" &&
                asset.sequenceKind !== "panorama"),
          )
        : rows;

    if (body.job === "thumbnails") {
      const queue = getThumbnailsQueue();
      await Promise.all(
        eligible.map((asset) =>
          queue.add(
            "thumbnails",
            { userId: asset.userId, assetId: asset.id },
            { removeOnComplete: 100, removeOnFail: 50 },
          ),
        ),
      );
    } else {
      const queue = getWebTranscodingQueue();
      await Promise.all(
        eligible.map((asset) =>
          queue.add(
            "webTranscoding",
            { userId: asset.userId, assetId: asset.id },
            { removeOnComplete: 100, removeOnFail: 50 },
          ),
        ),
      );
    }

    return NextResponse.json(
      {
        ok: true,
        queued: eligible.length,
        skipped: assetIds.length - eligible.length,
      },
      { status: 202 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
