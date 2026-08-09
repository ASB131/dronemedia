import { and, desc, eq } from "drizzle-orm";

import { getWebDb } from "@/lib/db";
import { drones, maintenanceLogs } from "@/lib/db/schema";

export type MaintenanceLogDto = {
  id: string;
  serviceDate: string;
  description: string;
  notes: string | null;
  flightHoursAtService: number | null;
  reminderThresholdHours: number | null;
  createdAt: string;
};

export async function listMaintenanceLogs(
  userId: string,
  droneId: string,
): Promise<MaintenanceLogDto[] | null> {
  const db = getWebDb();
  const [drone] = await db
    .select({ id: drones.id })
    .from(drones)
    .where(and(eq(drones.id, droneId), eq(drones.userId, userId)))
    .limit(1);

  if (!drone) return null;

  const rows = await db
    .select()
    .from(maintenanceLogs)
    .where(eq(maintenanceLogs.droneId, droneId))
    .orderBy(desc(maintenanceLogs.serviceDate));

  return rows.map((row) => ({
    id: row.id,
    serviceDate: row.serviceDate.toISOString(),
    description: row.description,
    notes: row.notes,
    flightHoursAtService: row.flightHoursAtService
      ? Number(row.flightHoursAtService)
      : null,
    reminderThresholdHours: row.reminderThresholdHours
      ? Number(row.reminderThresholdHours)
      : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function createMaintenanceLog(
  userId: string,
  droneId: string,
  input: {
    serviceDate: Date;
    description: string;
    notes?: string;
    flightHoursAtService?: number;
    reminderThresholdHours?: number;
  },
) {
  const db = getWebDb();
  const [drone] = await db
    .select({ id: drones.id, totalFlightHours: drones.totalFlightHours })
    .from(drones)
    .where(and(eq(drones.id, droneId), eq(drones.userId, userId)))
    .limit(1);

  if (!drone) return null;

  const hoursAtService =
    input.flightHoursAtService ?? Number(drone.totalFlightHours);

  const [log] = await db
    .insert(maintenanceLogs)
    .values({
      droneId,
      serviceDate: input.serviceDate,
      description: input.description,
      notes: input.notes ?? null,
      flightHoursAtService: String(hoursAtService),
      reminderThresholdHours:
        input.reminderThresholdHours != null
          ? String(input.reminderThresholdHours)
          : null,
    })
    .returning();

  return log;
}

export async function getServiceReminderForDrone(
  droneId: string,
  totalFlightHours: number,
): Promise<{ due: boolean; overdueByHours: number; description: string } | null> {
  const db = getWebDb();
  const [latest] = await db
    .select()
    .from(maintenanceLogs)
    .where(eq(maintenanceLogs.droneId, droneId))
    .orderBy(desc(maintenanceLogs.serviceDate))
    .limit(1);

  if (!latest?.reminderThresholdHours || !latest.flightHoursAtService) {
    return null;
  }

  const threshold = Number(latest.reminderThresholdHours);
  const atService = Number(latest.flightHoursAtService);
  const dueAt = atService + threshold;
  const overdueByHours = totalFlightHours - dueAt;
  if (overdueByHours < 0) return null;

  return {
    due: true,
    overdueByHours,
    description: latest.description,
  };
}
