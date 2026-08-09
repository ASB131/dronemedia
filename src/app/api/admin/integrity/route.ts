import { NextResponse } from "next/server";

import {
  getLatestIntegrityRun,
  listIntegrityRuns,
} from "@/lib/assets/integrity-check";
import { jsonError, requireAdminSession } from "@/lib/api/auth";
import { getWebDb } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { getIntegrityCheckQueue } from "@/lib/jobs/queues";
import { JOB_NAMES } from "@/lib/jobs/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminSession();
    const [latest, runs] = await Promise.all([
      getLatestIntegrityRun(),
      listIntegrityRuns(20),
    ]);
    return NextResponse.json({ latest, runs });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST() {
  try {
    const session = await requireAdminSession();
    const queue = getIntegrityCheckQueue();
    await queue.add(
      "integrityCheck",
      { triggeredBy: `admin:${session.user.id}` },
      { removeOnComplete: 20, removeOnFail: 20 },
    );

    const db = getWebDb();
    await db.insert(auditLogs).values({
      actorUserId: session.user.id,
      actionType: "integrity.run",
      targetType: "system",
      targetId: null,
      metadata: { jobType: JOB_NAMES.INTEGRITY_CHECK },
    });

    return NextResponse.json({ ok: true, queued: true }, { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
