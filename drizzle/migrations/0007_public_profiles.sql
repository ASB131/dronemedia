ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "is_public" boolean DEFAULT false NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "display_name" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bio" text;
CREATE INDEX IF NOT EXISTS "assets_is_public_idx" ON "assets" ("is_public");
CREATE INDEX IF NOT EXISTS "assets_user_public_idx" ON "assets" ("user_id","is_public");
