import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import { loadConfig, getDatabaseUrl } from "@/lib/config";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

let webPool: Pool | null = null;
let workerPool: Pool | null = null;
let webDb: Database | null = null;
let workerDb: Database | null = null;

function buildPoolConfig(poolName: "web" | "worker"): PoolConfig {
  const config = loadConfig();
  const poolSettings =
    poolName === "web"
      ? config.database.pool.web
      : config.database.pool.worker;

  return {
    connectionString: getDatabaseUrl(),
    max: poolSettings.max,
    idleTimeoutMillis: poolSettings.idleTimeoutMs,
  };
}

export function getWebPool(): Pool {
  if (!webPool) {
    webPool = new Pool(buildPoolConfig("web"));
  }
  return webPool;
}

export function getWorkerPool(): Pool {
  if (!workerPool) {
    workerPool = new Pool(buildPoolConfig("worker"));
  }
  return workerPool;
}

export function getWebDb(): Database {
  if (!webDb) {
    webDb = drizzle(getWebPool(), { schema });
  }
  return webDb;
}

export function getWorkerDb(): Database {
  if (!workerDb) {
    workerDb = drizzle(getWorkerPool(), { schema });
  }
  return workerDb;
}

export async function closeDbPools(): Promise<void> {
  await Promise.all([
    webPool?.end().catch(() => undefined),
    workerPool?.end().catch(() => undefined),
  ]);
  webPool = null;
  workerPool = null;
  webDb = null;
  workerDb = null;
}

export { schema };
