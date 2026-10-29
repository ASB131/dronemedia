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

  const healthy = [database, redis, storage].every((c) => c.ok);

  // Keep the public body minimal (status + version) for Docker healthchecks.
  // Detailed check payloads stay out of anonymous responses.
  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      version: APP_VERSION,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
