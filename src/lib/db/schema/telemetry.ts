import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { assets } from "./assets";
import { telemetryParseStatusEnum } from "./enums";
import { geometryLineString, geometryPoint } from "./postgis";

export const flightTelemetry = pgTable(
  "flight_telemetry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    flightPath: geometryLineString("flight_path"),
    maxAltitudeMeters: numeric("max_altitude_meters"),
    totalDistanceMeters: numeric("total_distance_meters"),
    flightDurationSeconds: numeric("flight_duration_seconds"),
    homePoint: geometryPoint("home_point"),
    rthEvents: jsonb("rth_events").$type<
      Array<{ timestampMs: number; lat: number; lng: number; label?: string }>
    >(),
    aircraftSerial: text("aircraft_serial"),
    parseStatus: telemetryParseStatusEnum("parse_status")
      .notNull()
      .default("unparsed"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("flight_telemetry_asset_id_uidx").on(table.assetId),
    index("flight_telemetry_parse_status_idx").on(table.parseStatus),
  ],
);

export const telemetryPoints = pgTable(
  "telemetry_points",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    flightTelemetryId: uuid("flight_telemetry_id").references(
      () => flightTelemetry.id,
      { onDelete: "cascade" },
    ),
    point: geometryPoint("point").notNull(),
    altitudeMeters: numeric("altitude_meters"),
    speedMps: numeric("speed_mps"),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    sequenceIndex: integer("sequence_index").notNull(),
  },
  (table) => [
    index("telemetry_points_asset_id_idx").on(table.assetId),
    index("telemetry_points_flight_telemetry_id_idx").on(
      table.flightTelemetryId,
    ),
    index("telemetry_points_recorded_at_idx").on(table.recordedAt),
    index("telemetry_points_asset_sequence_idx").on(
      table.assetId,
      table.sequenceIndex,
    ),
  ],
);

export const flightTelemetryRelations = relations(
  flightTelemetry,
  ({ one, many }) => ({
    asset: one(assets, {
      fields: [flightTelemetry.assetId],
      references: [assets.id],
    }),
    points: many(telemetryPoints),
  }),
);

export const telemetryPointsRelations = relations(
  telemetryPoints,
  ({ one }) => ({
    asset: one(assets, {
      fields: [telemetryPoints.assetId],
      references: [assets.id],
    }),
    flightTelemetry: one(flightTelemetry, {
      fields: [telemetryPoints.flightTelemetryId],
      references: [flightTelemetry.id],
    }),
  }),
);
