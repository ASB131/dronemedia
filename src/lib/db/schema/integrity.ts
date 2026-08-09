import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export type IntegrityIssueRow = {
  assetId: string;
  userId: string;
  extension: string;
  reason: "missing" | "hash_mismatch";
  expectedHash?: string;
  actualHash?: string;
};

export const integrityCheckRuns = pgTable(
  "integrity_check_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    status: text("status").notNull().default("running"),
    checkedCount: integer("checked_count").notNull().default(0),
    missingCount: integer("missing_count").notNull().default(0),
    hashMismatchCount: integer("hash_mismatch_count").notNull().default(0),
    issues: jsonb("issues").$type<IntegrityIssueRow[]>().notNull().default([]),
    triggeredBy: text("triggered_by").notNull().default("cron"),
    errorDetail: text("error_detail"),
  },
  (table) => [
    index("integrity_check_runs_started_at_idx").on(table.startedAt),
    index("integrity_check_runs_status_idx").on(table.status),
  ],
);
