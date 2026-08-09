#!/usr/bin/env tsx
/**
 * Applies Drizzle SQL migrations and PostGIS extensions/indexes/triggers.
 * Run via: npm run db:migrate
 */
import fs from "node:fs";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

async function runPostMigrationSql(client: Client): Promise<void> {
  const extrasPath = path.join(process.cwd(), "drizzle", "postgis_extras.sql");

  if (!fs.existsSync(extrasPath)) {
    console.log("[migrate] No PostGIS extras file found — skipping");
    return;
  }

  const sql = fs.readFileSync(extrasPath, "utf8");
  console.log("[migrate] Applying PostGIS extras (indexes, triggers)...");
  await client.query(sql);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    console.log("[migrate] Enabling PostGIS extension...");
    await client.query("CREATE EXTENSION IF NOT EXISTS postgis;");

    const db = drizzle(client);
    const migrationsFolder = path.join(process.cwd(), "drizzle", "migrations");

    if (
      fs.existsSync(migrationsFolder) &&
      fs.readdirSync(migrationsFolder).some((f) => f.endsWith(".sql"))
    ) {
      console.log("[migrate] Running Drizzle migrations...");
      await migrate(db, { migrationsFolder });
    } else {
      console.log("[migrate] No Drizzle migration files found — skipping");
    }

    await runPostMigrationSql(client);
    console.log("[migrate] Complete");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[migrate] Failed:", error);
  process.exit(1);
});
