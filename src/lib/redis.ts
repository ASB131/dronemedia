import Redis from "ioredis";

import { getRedisUrl } from "@/lib/config";

let redisClient: Redis | null = null;

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(getRedisUrl(), {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
  }
  return redisClient;
}

export async function checkRedisHealth(): Promise<{
  ok: boolean;
  detail?: string;
}> {
  const redis = getRedis();
  try {
    if (redis.status !== "ready") {
      await redis.connect();
    }
    const pong = await redis.ping();
    return pong === "PONG" ? { ok: true } : { ok: false, detail: "Unexpected PING response" };
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  }
}
