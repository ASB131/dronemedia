import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const jobFailures = pgTable(
  "job_failures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobType: text("job_type").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    errorDetail: text("error_detail").notNull(),
    attemptCount: integer("attempt_count").notNull().default(1),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    resolved: boolean("resolved").notNull().default(false),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("job_failures_job_type_idx").on(table.jobType),
    index("job_failures_resolved_idx").on(table.resolved),
    index("job_failures_created_at_idx").on(table.createdAt),
    index("job_failures_entity_idx").on(table.entityType, table.entityId),
  ],
);
