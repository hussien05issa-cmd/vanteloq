import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { organizationLocations, users, workspaces } from "./schema";

export const foodserviceRecords = sqliteTable("foodservice_records", {
  id: text("id").primaryKey().notNull(),
  organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull().references(() => organizationLocations.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["recipe", "period"] }).notNull(), recordKey: text("record_key").notNull(),
  name: text("name").notNull(), currency: text("currency").notNull(), sourceLabel: text("source_label").notNull(), asOfDate: text("as_of_date").notNull(),
  periodFrom: text("period_from").notNull().default(""), periodTo: text("period_to").notNull().default(""),
  payloadJson: text("payload_json").notNull(), version: integer("version").notNull().default(1),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, table => [
  unique("foodservice_records_scope_key").on(table.organizationId, table.locationId, table.kind, table.recordKey),
  index("foodservice_records_scope").on(table.organizationId, table.locationId, table.kind, table.updatedAt, table.id),
  check("foodservice_kind", sql`${table.kind} IN ('recipe','period')`),
  check("foodservice_name", sql`length(${table.name}) BETWEEN 1 AND 120`),
  check("foodservice_currency", sql`length(${table.currency})=3`),
  check("foodservice_source", sql`length(${table.sourceLabel}) BETWEEN 1 AND 120`),
  check("foodservice_json", sql`json_valid(${table.payloadJson})`),
  check("foodservice_version", sql`${table.version}>0`),
]);

/** The first retained revision is actual data, not reconstructed history. */
export const foodserviceRevisions = sqliteTable("foodservice_revisions", {
  id: text("id").primaryKey().notNull(),
  recordId: text("record_id").notNull().references(() => foodserviceRecords.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  version: integer("version").notNull(), contentJson: text("content_json").notNull(),
  recordedBy: text("recorded_by").references(() => users.id, { onDelete: "set null" }),
  recordedAt: integer("recorded_at").notNull(),
}, table => [
  unique("foodservice_revision_record_version").on(table.recordId, table.version),
  index("foodservice_revision_scope").on(table.organizationId, table.recordId, table.version),
  check("foodservice_revision_json", sql`json_valid(${table.contentJson})`),
  check("foodservice_revision_positive", sql`${table.version}>0`),
]);
