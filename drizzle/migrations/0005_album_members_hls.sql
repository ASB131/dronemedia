CREATE TYPE "album_member_role" AS ENUM('editor', 'viewer');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "album_members" (
  "album_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" "album_member_role" DEFAULT 'viewer' NOT NULL,
  "invited_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "album_members_album_id_user_id_pk" PRIMARY KEY("album_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "album_members" ADD CONSTRAINT "album_members_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "album_members" ADD CONSTRAINT "album_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "album_members" ADD CONSTRAINT "album_members_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "album_members_user_id_idx" ON "album_members" USING btree ("user_id");
