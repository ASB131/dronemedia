#!/usr/bin/env tsx
/**
 * Emergency admin recovery CLI.
 *
 * Usage:
 *   npx tsx scripts/reset-admin.ts --username admin --password newpassword
 *   npx tsx scripts/reset-admin.ts --grant-admin --username someuser
 *
 * Docker:
 *   docker compose exec worker npx tsx scripts/reset-admin.ts --username admin --password newpassword
 */
import { eq, or, sql } from "drizzle-orm";

import { hashPassword } from "../src/lib/auth/password";
import { getWebDb, closeDbPools } from "../src/lib/db";
import { users } from "../src/lib/db/schema";

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main() {
  const username = readArg("--username");
  const password = readArg("--password");
  const grantAdmin = process.argv.includes("--grant-admin");

  if (!username) {
    console.error("Usage: --username <name> [--password <pass>] [--grant-admin]");
    process.exit(1);
  }

  if (!password && !grantAdmin) {
    console.error("Provide --password and/or --grant-admin");
    process.exit(1);
  }

  const db = getWebDb();
  const normalized = username.trim().toLowerCase();
  const rows = await db
    .select()
    .from(users)
    .where(
      or(
        eq(sql`lower(${users.username})`, normalized),
        eq(sql`lower(${users.email})`, normalized),
      ),
    )
    .limit(1);

  const user = rows[0];
  if (!user) {
    console.error(`User not found: ${username}`);
    process.exit(1);
  }

  const updates: Partial<typeof users.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (password) {
    updates.passwordHash = await hashPassword(password);
  }

  if (grantAdmin) {
    updates.role = "admin";
    updates.approvalStatus = "approved";
  }

  await db.update(users).set(updates).where(eq(users.id, user.id));

  console.log(`Updated user "${user.username}" (${user.id})`);
  if (password) console.log("- Password reset");
  if (grantAdmin) console.log("- Admin role granted and account approved");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await closeDbPools();
  });
