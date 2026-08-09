import { sql, type SQL } from "drizzle-orm";

import { assets } from "./schema/assets";

/** Prefer user override, fall back to extracted original capture time. */
export function effectiveCapturedAt(): SQL {
  return sql`coalesce(${assets.capturedAtOverride}, ${assets.capturedAtOriginal})`;
}

/** Prefer user override, fall back to extracted original location. */
export function effectiveLocation(): SQL {
  return sql`coalesce(${assets.locationOverride}, ${assets.locationOriginal})`;
}

/** Full-text query against the assets search_vector column. */
export function assetSearchQuery(query: string): SQL {
  return sql`${assets.searchVector} @@ plainto_tsquery('english', ${query})`;
}

/** PostGIS radius filter using effective location (meters). */
export function withinRadius(
  lat: number,
  lng: number,
  radiusMeters: number,
): SQL {
  return sql`
    ST_DWithin(
      coalesce(${assets.locationOverride}, ${assets.locationOriginal})::geography,
      ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
      ${radiusMeters}
    )
  `;
}

/** PostGIS bounding-box filter using effective location (WGS84). */
export function withinBbox(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
): SQL {
  return sql`
    ST_Within(
      coalesce(${assets.locationOverride}, ${assets.locationOriginal}),
      ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)
    )
  `;
}
