-- Sequence / hyperlapse support
ALTER TYPE "asset_type" ADD VALUE IF NOT EXISTS 'sequence';
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "sequence_kind" AS ENUM ('hyperlapse');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "sequence_kind" "sequence_kind";
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "frame_count" integer;
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "sequence_folder" text;
--> statement-breakpoint
ALTER TABLE "upload_files" ADD COLUMN IF NOT EXISTS "relative_path" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequence_frames" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "frame_index" integer NOT NULL,
  "filename" text NOT NULL,
  "storage_key" text NOT NULL,
  "file_size_bytes" bigint NOT NULL,
  "content_hash" text NOT NULL,
  "captured_at" timestamp with time zone,
  "location" geometry(Point, 4326),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sequence_frames_asset_id_idx" ON "sequence_frames" ("asset_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sequence_frames_user_id_idx" ON "sequence_frames" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sequence_frames_asset_index_uidx"
  ON "sequence_frames" ("asset_id", "frame_index");
