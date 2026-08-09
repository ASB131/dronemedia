CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."asset_type" AS ENUM('photo', 'video');--> statement-breakpoint
CREATE TYPE "public"."audit_action_type" AS ENUM('user.approve', 'user.reject', 'user.disable', 'user.delete', 'user.quota_change', 'share.revoke', 'invite.create', 'invite.revoke');--> statement-breakpoint
CREATE TYPE "public"."chapter_source" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."flight_grouping_method" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."invite_status" AS ENUM('active', 'used', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."share_target_type" AS ENUM('asset', 'flight', 'album');--> statement-breakpoint
CREATE TYPE "public"."share_type" AS ENUM('public', 'user');--> statement-breakpoint
CREATE TYPE "public"."telemetry_parse_status" AS ENUM('parsed', 'unparsed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'user');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"label" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action_type" "audit_action_type" NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"status" "invite_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"used_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_token" text NOT NULL,
	"device_info" jsonb,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"approval_status" "approval_status" DEFAULT 'pending' NOT NULL,
	"storage_quota_bytes" bigint NOT NULL,
	"storage_used_bytes" bigint DEFAULT 0 NOT NULL,
	"invite_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "job_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"error_detail" text NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"payload" jsonb,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"model" text,
	"serial_number" text,
	"total_flight_hours" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_distance_meters" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drone_id" uuid NOT NULL,
	"service_date" timestamp with time zone NOT NULL,
	"description" text NOT NULL,
	"flight_hours_at_service" numeric(12, 2),
	"notes" text,
	"attachments" jsonb,
	"reminder_threshold_hours" numeric(12, 2),
	"reminder_threshold_cycles" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"extension" text NOT NULL,
	"content_hash" text NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"asset_type" "asset_type" NOT NULL,
	"main_file_ext" text NOT NULL,
	"has_srt" boolean DEFAULT false NOT NULL,
	"has_lrf" boolean DEFAULT false NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"content_hash" text,
	"perceptual_hash" text,
	"file_size_bytes" bigint,
	"description" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"captured_at_original" timestamp with time zone,
	"captured_at_override" timestamp with time zone,
	"captured_timezone" text,
	"location_original" geometry(Point, 4326),
	"location_override" geometry(Point, 4326),
	"drone_id" uuid,
	"flight_id" uuid,
	"search_vector" "tsvector",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"drone_id" uuid,
	"title" text,
	"start_time" timestamp with time zone,
	"end_time" timestamp with time zone,
	"total_distance_meters" numeric,
	"max_altitude_meters" numeric,
	"total_duration_seconds" numeric,
	"grouping_method" "flight_grouping_method" DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"timestamp_offset_ms" integer NOT NULL,
	"label" text NOT NULL,
	"source" "chapter_source" DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flight_telemetry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"flight_path" geometry(LineString, 4326),
	"max_altitude_meters" numeric,
	"total_distance_meters" numeric,
	"flight_duration_seconds" numeric,
	"home_point" geometry(Point, 4326),
	"rth_events" jsonb,
	"aircraft_serial" text,
	"parse_status" "telemetry_parse_status" DEFAULT 'unparsed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"flight_telemetry_id" uuid,
	"point" geometry(Point, 4326) NOT NULL,
	"altitude_meters" numeric,
	"speed_mps" numeric,
	"recorded_at" timestamp with time zone NOT NULL,
	"sequence_index" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "album_assets" (
	"album_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "album_assets_album_id_asset_id_pk" PRIMARY KEY("album_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "albums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_recipients" (
	"share_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_recipients_share_id_recipient_user_id_pk" PRIMARY KEY("share_id","recipient_user_id")
);
--> statement-breakpoint
CREATE TABLE "shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"share_type" "share_type" NOT NULL,
	"target_type" "share_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"password_hash" text,
	"include_exact_gps" boolean DEFAULT false NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shares_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drones" ADD CONSTRAINT "drones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_logs" ADD CONSTRAINT "maintenance_logs_drone_id_drones_id_fk" FOREIGN KEY ("drone_id") REFERENCES "public"."drones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_files" ADD CONSTRAINT "asset_files_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_files" ADD CONSTRAINT "asset_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_drone_id_drones_id_fk" FOREIGN KEY ("drone_id") REFERENCES "public"."drones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_flight_id_flights_id_fk" FOREIGN KEY ("flight_id") REFERENCES "public"."flights"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_drone_id_drones_id_fk" FOREIGN KEY ("drone_id") REFERENCES "public"."drones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_chapters" ADD CONSTRAINT "video_chapters_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_telemetry" ADD CONSTRAINT "flight_telemetry_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_points" ADD CONSTRAINT "telemetry_points_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_points" ADD CONSTRAINT "telemetry_points_flight_telemetry_id_flight_telemetry_id_fk" FOREIGN KEY ("flight_telemetry_id") REFERENCES "public"."flight_telemetry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "album_assets" ADD CONSTRAINT "album_assets_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "album_assets" ADD CONSTRAINT "album_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "albums" ADD CONSTRAINT "albums_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_recipients" ADD CONSTRAINT "share_recipients_share_id_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_recipients" ADD CONSTRAINT "share_recipients_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_type_idx" ON "audit_logs" USING btree ("action_type");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "invites_status_idx" ON "invites" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_last_active_at_idx" ON "sessions" USING btree ("last_active_at");--> statement-breakpoint
CREATE INDEX "users_approval_status_idx" ON "users" USING btree ("approval_status");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "job_failures_job_type_idx" ON "job_failures" USING btree ("job_type");--> statement-breakpoint
CREATE INDEX "job_failures_resolved_idx" ON "job_failures" USING btree ("resolved");--> statement-breakpoint
CREATE INDEX "job_failures_created_at_idx" ON "job_failures" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "job_failures_entity_idx" ON "job_failures" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "drones_user_id_idx" ON "drones" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "drones_serial_number_idx" ON "drones" USING btree ("serial_number");--> statement-breakpoint
CREATE INDEX "maintenance_logs_drone_id_idx" ON "maintenance_logs" USING btree ("drone_id");--> statement-breakpoint
CREATE INDEX "asset_files_asset_id_idx" ON "asset_files" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_files_content_hash_idx" ON "asset_files" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_files_user_content_hash_uidx" ON "asset_files" USING btree ("user_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_files_asset_extension_uidx" ON "asset_files" USING btree ("asset_id","extension");--> statement-breakpoint
CREATE INDEX "assets_user_id_idx" ON "assets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "assets_flight_id_idx" ON "assets" USING btree ("flight_id");--> statement-breakpoint
CREATE INDEX "assets_drone_id_idx" ON "assets" USING btree ("drone_id");--> statement-breakpoint
CREATE INDEX "assets_deleted_at_idx" ON "assets" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "assets_favorite_idx" ON "assets" USING btree ("favorite");--> statement-breakpoint
CREATE INDEX "assets_captured_at_original_idx" ON "assets" USING btree ("captured_at_original");--> statement-breakpoint
CREATE INDEX "assets_content_hash_idx" ON "assets" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "assets_perceptual_hash_idx" ON "assets" USING btree ("perceptual_hash");--> statement-breakpoint
CREATE INDEX "assets_tags_idx" ON "assets" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "flights_user_id_idx" ON "flights" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "flights_drone_id_idx" ON "flights" USING btree ("drone_id");--> statement-breakpoint
CREATE INDEX "flights_start_time_idx" ON "flights" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX "video_chapters_asset_id_idx" ON "video_chapters" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "video_chapters_asset_timestamp_idx" ON "video_chapters" USING btree ("asset_id","timestamp_offset_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "flight_telemetry_asset_id_uidx" ON "flight_telemetry" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "flight_telemetry_parse_status_idx" ON "flight_telemetry" USING btree ("parse_status");--> statement-breakpoint
CREATE INDEX "telemetry_points_asset_id_idx" ON "telemetry_points" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "telemetry_points_flight_telemetry_id_idx" ON "telemetry_points" USING btree ("flight_telemetry_id");--> statement-breakpoint
CREATE INDEX "telemetry_points_recorded_at_idx" ON "telemetry_points" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "telemetry_points_asset_sequence_idx" ON "telemetry_points" USING btree ("asset_id","sequence_index");--> statement-breakpoint
CREATE INDEX "album_assets_asset_id_idx" ON "album_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "albums_user_id_idx" ON "albums" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "share_recipients_recipient_user_id_idx" ON "share_recipients" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "shares_owner_user_id_idx" ON "shares" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "shares_target_idx" ON "shares" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "shares_revoked_idx" ON "shares" USING btree ("revoked");--> statement-breakpoint
CREATE UNIQUE INDEX "shares_token_uidx" ON "shares" USING btree ("token");