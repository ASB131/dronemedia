CREATE TABLE IF NOT EXISTS "duplicate_dismissals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "group_key" text NOT NULL,
  "member_fingerprint" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "duplicate_dismissals"
    ADD CONSTRAINT "duplicate_dismissals_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "duplicate_dismissals_user_kind_key_uidx"
  ON "duplicate_dismissals" ("user_id","kind","group_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "duplicate_dismissals_user_idx"
  ON "duplicate_dismissals" ("user_id");
