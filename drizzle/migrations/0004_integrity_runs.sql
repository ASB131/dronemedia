ALTER TYPE "audit_action_type" ADD VALUE IF NOT EXISTS 'integrity.run';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integrity_check_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "status" text DEFAULT 'running' NOT NULL,
  "checked_count" integer DEFAULT 0 NOT NULL,
  "missing_count" integer DEFAULT 0 NOT NULL,
  "hash_mismatch_count" integer DEFAULT 0 NOT NULL,
  "issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "triggered_by" text DEFAULT 'cron' NOT NULL,
  "error_detail" text
);

CREATE INDEX IF NOT EXISTS "integrity_check_runs_started_at_idx"
  ON "integrity_check_runs" ("started_at");
CREATE INDEX IF NOT EXISTS "integrity_check_runs_status_idx"
  ON "integrity_check_runs" ("status");
