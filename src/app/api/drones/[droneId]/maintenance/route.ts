import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import {
  createMaintenanceLog,
  listMaintenanceLogs,
} from "@/lib/drones/maintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  serviceDate: z.string().datetime(),
  description: z.string().trim().min(1).max(500),
  notes: z.string().trim().max(1000).optional(),
  flightHoursAtService: z.number().nonnegative().optional(),
  reminderThresholdHours: z.number().positive().max(10000).optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ droneId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { droneId } = await context.params;
    const logs = await listMaintenanceLogs(session.user.id, droneId);

    if (!logs) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ logs });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ droneId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { droneId } = await context.params;
    const body = createSchema.parse(await request.json());
    const log = await createMaintenanceLog(session.user.id, droneId, {
      serviceDate: new Date(body.serviceDate),
      description: body.description,
      notes: body.notes,
      flightHoursAtService: body.flightHoursAtService,
      reminderThresholdHours: body.reminderThresholdHours,
    });

    if (!log) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ log }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
