import { customType } from "drizzle-orm/pg-core";

/** PostGIS geometry(Point, 4326) — stored as WKB/EWKT in driver. */
export const geometryPoint = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geometry(Point, 4326)";
  },
});

/** PostGIS geometry(LineString, 4326) for flight paths. */
export const geometryLineString = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geometry(LineString, 4326)";
  },
});

/** PostgreSQL tsvector for full-text search. */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});
