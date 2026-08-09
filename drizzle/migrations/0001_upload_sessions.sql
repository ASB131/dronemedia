CREATE TYPE "public"."upload_batch_status" AS ENUM('open', 'committing', 'committed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."upload_file_status" AS ENUM('pending', 'uploading', 'assembling', 'complete', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "upload_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "upload_batch_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "upload_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"asset_id" uuid,
	"display_name" text NOT NULL,
	"basename" text NOT NULL,
	"extension" text NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"received_bytes" bigint DEFAULT 0 NOT NULL,
	"chunk_size_bytes" integer NOT NULL,
	"total_chunks" integer NOT NULL,
	"uploaded_chunk_indices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "upload_file_status" DEFAULT 'pending' NOT NULL,
	"content_hash" text,
	"staging_prefix" text NOT NULL,
	"error_message" text,
	"last_chunk_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "upload_batches" ADD CONSTRAINT "upload_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_files" ADD CONSTRAINT "upload_files_batch_id_upload_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."upload_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_files" ADD CONSTRAINT "upload_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_files" ADD CONSTRAINT "upload_files_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "upload_batches_user_id_idx" ON "upload_batches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "upload_batches_status_idx" ON "upload_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "upload_files_batch_id_idx" ON "upload_files" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "upload_files_user_id_idx" ON "upload_files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "upload_files_status_idx" ON "upload_files" USING btree ("status");--> statement-breakpoint
CREATE INDEX "upload_files_expires_at_idx" ON "upload_files" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "upload_files_basename_idx" ON "upload_files" USING btree ("batch_id","basename");