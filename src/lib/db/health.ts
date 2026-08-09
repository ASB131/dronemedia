import { Client } from "pg";

import { getDatabaseUrl } from "@/lib/config";

export async function checkDatabaseHealth(): Promise<{
  ok: boolean;
  detail?: string;
}> {
  const client = new Client({ connectionString: getDatabaseUrl() });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  } finally {
    await client.end().catch(() => undefined);
  }
}
