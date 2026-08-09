DO $$ BEGIN
  CREATE TYPE "lut_color_profile" AS ENUM('d_log', 'd_logm');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "luts"
  ADD COLUMN IF NOT EXISTS "color_profile" "lut_color_profile" NOT NULL DEFAULT 'd_log';

CREATE INDEX IF NOT EXISTS "luts_color_profile_idx" ON "luts" ("color_profile");
