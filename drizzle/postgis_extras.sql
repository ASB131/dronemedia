-- PostGIS spatial indexes, full-text search, and deferred foreign keys.
-- Idempotent — safe to re-run on every migration.

-- Deferred FK: users.invite_id → invites (avoids circular schema dependency)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_invite_id_invites_id_fk'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_invite_id_invites_id_fk"
      FOREIGN KEY ("invite_id") REFERENCES "invites"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- GiST indexes for spatial queries (radius, bounding box)
CREATE INDEX IF NOT EXISTS "assets_location_original_gist_idx"
  ON "assets" USING gist ("location_original");

CREATE INDEX IF NOT EXISTS "assets_location_override_gist_idx"
  ON "assets" USING gist ("location_override");

CREATE INDEX IF NOT EXISTS "flight_telemetry_flight_path_gist_idx"
  ON "flight_telemetry" USING gist ("flight_path");

CREATE INDEX IF NOT EXISTS "flight_telemetry_home_point_gist_idx"
  ON "flight_telemetry" USING gist ("home_point");

CREATE INDEX IF NOT EXISTS "telemetry_points_point_gist_idx"
  ON "telemetry_points" USING gist ("point");

-- GIN index for full-text search on display_name, tags, description
CREATE INDEX IF NOT EXISTS "assets_search_vector_gin_idx"
  ON "assets" USING gin ("search_vector");

-- Keep search_vector in sync with searchable fields
CREATE OR REPLACE FUNCTION assets_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.display_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS assets_search_vector_trigger ON "assets";
CREATE TRIGGER assets_search_vector_trigger
  BEFORE INSERT OR UPDATE OF display_name, tags, description
  ON "assets"
  FOR EACH ROW
  EXECUTE PROCEDURE assets_search_vector_update();
