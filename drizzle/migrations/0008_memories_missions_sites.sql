CREATE TABLE IF NOT EXISTS "site_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "note" text,
  "location" geometry(Point, 4326) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_notes_user_id_idx" ON "site_notes" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mission_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "require_srt" boolean DEFAULT false NOT NULL,
  "require_lrf" boolean DEFAULT false NOT NULL,
  "default_drone_id" uuid REFERENCES "drones"("id") ON DELETE SET NULL,
  "default_album_id" uuid REFERENCES "albums"("id") ON DELETE SET NULL,
  "default_tags" text[] DEFAULT '{}'::text[] NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mission_templates_user_id_idx" ON "mission_templates" ("user_id");
