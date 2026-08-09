import { getRedis } from "@/lib/redis";
import { storeAndPublishNotification } from "@/lib/notifications/store";
import { getServiceReminderForDrone } from "@/lib/drones/maintenance";
import { listDronesForUser } from "@/lib/drones/queries";

/** Publish at most one service-due notification per drone per day. */
export async function notifyDueServiceReminders(userId: string) {
  const drones = await listDronesForUser(userId);
  if (drones.length === 0) return;

  const redis = getRedis();
  if (redis.status !== "ready") {
    await redis.connect();
  }

  const dayKey = new Date().toISOString().slice(0, 10);

  for (const drone of drones) {
    const reminder = await getServiceReminderForDrone(
      drone.id,
      drone.totalFlightHours,
    );
    if (!reminder?.due) continue;

    const dedupeKey = `service-reminder:${userId}:${drone.id}:${dayKey}`;
    const claimed = await redis.set(dedupeKey, "1", "EX", 60 * 60 * 36, "NX");
    if (claimed !== "OK") continue;

    await storeAndPublishNotification(redis, {
      userId,
      jobType: "serviceReminder",
      status: "failed",
      message: `${drone.name}: ${reminder.description} (${reminder.overdueByHours.toFixed(1)} h overdue)`,
      timestamp: new Date().toISOString(),
    });
  }
}
