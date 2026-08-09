import { NextResponse } from "next/server";

import { APP_VERSION } from "@/lib/config";
import { checkDatabaseHealth } from "@/lib/db/health";
import { checkRedisHealth } from "@/lib/redis";
import { getStorageAdapter } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const [database, redis, storage] = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
    getStorageAdapter().healthCheck(),
  ]);

  const checks = { database, redis, storage };
  const healthy = Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      version: APP_VERSION,
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
