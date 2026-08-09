ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "has_proxy" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "has_hls" boolean DEFAULT false NOT NULL;
