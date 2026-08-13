import { NextResponse } from "next/server";
import { z } from "zod";

import {
  clearFalseDuplicateFlags,
  requeueThumbnailsForUser,
} from "@/lib/assets/duplicate-flags";
import {
  listLargeFilesForUser,
  listLocatedAssetsForUser,
  listNearDuplicateCandidates,
} from "@/lib/assets/mutations";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { loadConfig } from "@/lib/config";
import { getJobsStatusForUser } from "@/lib/jobs/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await requireApprovedSession();
    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") ?? "large";

    if (view === "duplicates") {
      const config = loadConfig();
      const duplicates = await listNearDuplicateCandidates(session.user.id);
      return NextResponse.json({
        duplicates,
        algorithm: config.deduplication.algorithm,
        onDuplicate: config.deduplication.onDuplicate,
      });
    }

    if (view === "jobs") {
      const { listDeferredJobsForUser } = await import("@/lib/jobs/gates");
      const { getUploadStagingStatusForUser } = await import(
        "@/lib/upload/staging-status"
      );
      const [jobs, deferred, staging] = await Promise.all([
        getJobsStatusForUser(session.user.id),
        listDeferredJobsForUser(session.user.id),
        getUploadStagingStatusForUser(session.user.id),
      ]);
      return NextResponse.json({ jobs, deferred, staging });
    }

    if (view === "location") {
      const assets = await listLocatedAssetsForUser(session.user.id);
      return NextResponse.json({ assets });
    }

    const assets = await listLargeFilesForUser(session.user.id);
    return NextResponse.json({ assets });
  } catch (error) {
    return jsonError(error);
  }
}

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("clearFalseDuplicateFlags") }),
  z.object({
    action: z.literal("requeueThumbnails"),
    missingOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
]);

export async function POST(request: Request) {
  try {
    const session = await requireApprovedSession();
    const body = postSchema.parse(await request.json());

    if (body.action === "clearFalseDuplicateFlags") {
      const result = await clearFalseDuplicateFlags(session.user.id);
      return NextResponse.json({ ok: true, ...result });
    }

    const result = await requeueThumbnailsForUser(session.user.id, {
      missingOnly: body.missingOnly,
      limit: body.limit,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
