import { NextResponse } from "next/server";

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
      const jobs = await getJobsStatusForUser(session.user.id);
      return NextResponse.json({ jobs });
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
