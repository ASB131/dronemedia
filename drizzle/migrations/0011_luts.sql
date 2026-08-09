ALTER TYPE "audit_action_type" ADD VALUE IF NOT EXISTS 'lut.create';
ALTER TYPE "audit_action_type" ADD VALUE IF NOT EXISTS 'lut.delete';

CREATE TABLE IF NOT EXISTS "luts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "storage_key" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "luts_created_at_idx" ON "luts" ("created_at");
CREATE INDEX IF NOT EXISTS "luts_name_idx" ON "luts" ("name");

ALTER TABLE "assets"
  ADD COLUMN IF NOT EXISTS "preferred_lut_id" uuid
  REFERENCES "luts"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "assets_preferred_lut_id_idx"
  ON "assets" ("preferred_lut_id");
