DROP INDEX IF EXISTS "asset_files_user_content_hash_uidx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_files_user_content_hash_idx" ON "asset_files" USING btree ("user_id","content_hash");
