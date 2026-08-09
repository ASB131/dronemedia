import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./users";

export const drones = pgTable(
  "drones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    model: text("model"),
    serialNumber: text("serial_number"),
    totalFlightHours: numeric("total_flight_hours", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    totalDistanceMeters: numeric("total_distance_meters", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("drones_user_id_idx").on(table.userId),
    index("drones_serial_number_idx").on(table.serialNumber),
  ],
);

export const maintenanceLogs = pgTable(
  "maintenance_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    droneId: uuid("drone_id")
      .notNull()
      .references(() => drones.id, { onDelete: "cascade" }),
    serviceDate: timestamp("service_date", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    description: text("description").notNull(),
    flightHoursAtService: numeric("flight_hours_at_service", {
      precision: 12,
      scale: 2,
    }),
    notes: text("notes"),
    attachments: jsonb("attachments").$type<
      Array<{ name: string; path: string }>
    >(),
    reminderThresholdHours: numeric("reminder_threshold_hours", {
      precision: 12,
      scale: 2,
    }),
    reminderThresholdCycles: integer("reminder_threshold_cycles"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("maintenance_logs_drone_id_idx").on(table.droneId)],
);

export const dronesRelations = relations(drones, ({ one, many }) => ({
  user: one(users, {
    fields: [drones.userId],
    references: [users.id],
  }),
  maintenanceLogs: many(maintenanceLogs),
}));

export const maintenanceLogsRelations = relations(maintenanceLogs, ({ one }) => ({
  drone: one(drones, {
    fields: [maintenanceLogs.droneId],
    references: [drones.id],
  }),
}));
