import { NextResponse } from "next/server";
import { z } from "zod";

import {
  listAuditLogs,
  listUnresolvedJobFailures,
  resolveJobFailure,
} from "@/lib/assets/exports";
import { jsonError, requireAdminSession } from "@/lib/api/auth";
import { getWebTranscodingQueue } from "@/lib/jobs/queues";
import { getWebDb } from "@/lib/db";
import { jobFailures } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAdminSession();
    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") ?? "audit";

    if (view === "jobs") {
      const failures = await listUnresolvedJobFailures();
      return NextResponse.json({ failures });
    }

    const logs = await listAuditLogs();
    return NextResponse.json({ logs });
  } catch (error) {
    return jsonError(error);
  }
}

const patchSchema = z.object({
  failureId: z.string().uuid(),
  action: z.enum(["resolve", "retry"]),
});

export async function PATCH(request: Request) {
  try {
    await requireAdminSession();
    const body = patchSchema.parse(await request.json());

    if (body.action === "resolve") {
      const row = await resolveJobFailure(body.failureId);
      if (!row) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    }

    const db = getWebDb();
    const [failure] = await db
      .select()
      .from(jobFailures)
      .where(eq(jobFailures.id, body.failureId))
      .limit(1);

    if (!failure) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const payload = failure.payload as {
      userId?: string;
      assetId?: string;
    } | null;

    if (
      failure.jobType === "webTranscoding" &&
      payload?.userId &&
      payload?.assetId
    ) {
      const { isJobGateEnabled } = await import("@/lib/jobs/gates");
      const { JOB_NAMES } = await import("@/lib/jobs/types");
      if (isJobGateEnabled(JOB_NAMES.WEB_TRANSCODING, true)) {
        await getWebTranscodingQueue().add("webTranscoding", {
          userId: payload.userId,
          assetId: payload.assetId,
        });
      }
    }

    await resolveJobFailure(body.failureId);
    return NextResponse.json({ ok: true, retried: true });
  } catch (error) {
    return jsonError(error);
  }
}
