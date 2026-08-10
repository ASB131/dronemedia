import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, requireAdminSession } from "@/lib/api/auth";
import { getWebDb } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import {
  gateLabel,
  getJobGates,
  isGatedJob,
  setJobGate,
  syncGateQueuePausedState,
  type GatedJobName,
} from "@/lib/jobs/gates";
import { getJobsStatusGlobal } from "@/lib/jobs/status";
import { JOB_NAMES } from "@/lib/jobs/types";
import { listUnresolvedJobFailures } from "@/lib/assets/exports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  gate: z.enum([JOB_NAMES.WEB_TRANSCODING, JOB_NAMES.PANORAMA_STITCH]),
  enabled: z.boolean(),
});

export async function GET() {
  try {
    await requireAdminSession();
    await syncGateQueuePausedState().catch(() => undefined);
    const [status, failures, gates] = await Promise.all([
      getJobsStatusGlobal(),
      listUnresolvedJobFailures(100),
      Promise.resolve(getJobGates(true)),
    ]);
    return NextResponse.json({
      status,
      failures,
      gates,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireAdminSession();
    const body = patchSchema.parse(await request.json());
    if (!isGatedJob(body.gate)) {
      return NextResponse.json({ error: "Invalid gate" }, { status: 400 });
    }

    const result = await setJobGate(body.gate as GatedJobName, body.enabled);

    const db = getWebDb();
    await db.insert(auditLogs).values({
      actorUserId: session.user.id,
      actionType: "integrity.run",
      targetType: "job_gate",
      targetId: null,
      metadata: {
        action: "jobs.gate",
        gate: body.gate,
        enabled: body.enabled,
        backfilled: result.backfilled,
        label: gateLabel(body.gate as GatedJobName),
      },
    });

    const [status, failures, gates] = await Promise.all([
      getJobsStatusGlobal(),
      listUnresolvedJobFailures(100),
      Promise.resolve(getJobGates(true)),
    ]);

    return NextResponse.json({
      ok: true,
      ...result,
      status,
      failures,
      gates,
    });
  } catch (error) {
    return jsonError(error);
  }
}
