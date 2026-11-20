ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "cover_asset_id" uuid;
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "cover_image_key" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "trips" ADD CONSTRAINT "trips_cover_asset_id_assets_id_fk"
    FOREIGN KEY ("cover_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;