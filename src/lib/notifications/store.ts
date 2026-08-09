import { z } from "zod";

const notificationSchema = z.object({
  userId: z.string().uuid(),
  jobType: z.string(),
  assetId: z.string().uuid().optional(),
  assetName: z.string().optional(),
  status: z.enum(["queued", "processing", "complete", "failed"]),
  message: z.string().optional(),
  timestamp: z.string(),
});

export type StoredNotification = z.infer<typeof notificationSchema>;

const HISTORY_KEY = (userId: string) => `notifications:history:${userId}`;
const CHANNEL_KEY = (userId: string) => `notifications:${userId}`;

export async function storeAndPublishNotification(
  redis: import("ioredis").default,
  event: StoredNotification,
) {
  const payload = JSON.stringify(event);
  const historyKey = HISTORY_KEY(event.userId);

  await redis
    .multi()
    .lpush(historyKey, payload)
    .ltrim(historyKey, 0, 999)
    .publish(CHANNEL_KEY(event.userId), payload)
    .exec();
}

export async function listNotificationsSince(
  redis: import("ioredis").default,
  userId: string,
  since?: string,
) {
  const raw = await redis.lrange(HISTORY_KEY(userId), 0, 999);
  const sinceMs = since ? Date.parse(since) : 0;

  const parsed: StoredNotification[] = [];
  for (const item of raw) {
    try {
      const event = notificationSchema.parse(JSON.parse(item));
      if (Date.parse(event.timestamp) >= sinceMs) {
        parsed.push(event);
      }
    } catch {
      // skip malformed
    }
  }

  return parsed.reverse();
}

export async function clearNotificationHistory(
  redis: import("ioredis").default,
  userId: string,
) {
  await redis.del(HISTORY_KEY(userId));
}

export { CHANNEL_KEY, notificationSchema };
