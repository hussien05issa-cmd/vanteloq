import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { organizationLocations, users, workspaces } from "../db/schema";

export const sectorOperationRecords = sqliteTable("sector_operation_records", {
  id: text("id").primaryKey().notNull(),
  organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull().references(() => organizationLocations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), recordKey: text("record_key").notNull(), currency: text("currency").notNull(),
  state: text("state").notNull().default("draft"), version: integer("version").notNull().default(1),
  contentJson: text("content_json").notNull(), linkedJson: text("linked_json").notNull().default("[]"),
  lastRequestId: text("last_request_id").notNull(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, t => [
  unique("sector_record_tenant_id").on(t.organizationId,t.id),
  unique("sector_record_business_key").on(t.organizationId,t.locationId,t.kind,t.recordKey),
  index("sector_record_scope").on(t.organizationId,t.locationId,t.kind,t.state,t.updatedAt),
  check("sector_record_kind",sql`${t.kind} IN ('prep_plan','prep_batch','supplier_check','service_period','delivery_order','furniture_order','dealer_funding','room','reservation')`),
  check("sector_record_state",sql`${t.state} IN ('draft','reviewed','active','completed','cancelled')`),
  check("sector_record_version",sql`${t.version}>0`),
  check("sector_record_json",sql`json_valid(${t.contentJson}) AND json_valid(${t.linkedJson})`),
]);
export const sectorOperationRevisions = sqliteTable("sector_operation_revisions", {
  id:text("id").primaryKey().notNull(), organizationId:text("organization_id").notNull(),recordId:text("record_id").notNull(),
  version:integer("version").notNull(),action:text("action").notNull(),reason:text("reason").notNull().default(""),state:text("state").notNull(),contentJson:text("content_json").notNull(),linkedJson:text("linked_json").notNull(),
  actorId:text("actor_id").references(()=>users.id,{onDelete:"set null"}),createdAt:integer("created_at").notNull(),
},t=>[
  foreignKey({columns:[t.organizationId,t.recordId],foreignColumns:[sectorOperationRecords.organizationId,sectorOperationRecords.id]}).onDelete("cascade"),
  unique("sector_revision_version").on(t.organizationId,t.recordId,t.version),check("sector_revision_json",sql`json_valid(${t.contentJson}) AND json_valid(${t.linkedJson})`),
]);
export const sectorOperationRequests = sqliteTable("sector_operation_requests",{
  id:text("id").primaryKey().notNull(),organizationId:text("organization_id").notNull(),recordId:text("record_id").notNull(),actorId:text("actor_id").notNull().references(()=>users.id,{onDelete:"cascade"}),
  requestKey:text("request_key").notNull(),requestHash:text("request_hash").notNull(),resultJson:text("result_json").notNull(),success:integer("success").notNull(),createdAt:integer("created_at").notNull(),
},t=>[
  foreignKey({columns:[t.organizationId,t.recordId],foreignColumns:[sectorOperationRecords.organizationId,sectorOperationRecords.id]}).onDelete("cascade"),
  unique("sector_request_key").on(t.organizationId,t.actorId,t.requestKey),check("sector_request_committed",sql`${t.success}=1`),check("sector_request_json",sql`json_valid(${t.resultJson})`),
]);
/** One reviewed booking may occupy each physical room-night; same-day departures do not overlap arrivals. */
export const sectorRoomNights = sqliteTable("sector_room_nights",{
  id:text("id").primaryKey().notNull(),organizationId:text("organization_id").notNull(),recordId:text("record_id").notNull(),roomId:text("room_id").notNull(),stayDate:text("stay_date").notNull(),
},t=>[
  foreignKey({columns:[t.organizationId,t.recordId],foreignColumns:[sectorOperationRecords.organizationId,sectorOperationRecords.id]}).onDelete("cascade"),
  foreignKey({columns:[t.organizationId,t.roomId],foreignColumns:[sectorOperationRecords.organizationId,sectorOperationRecords.id]}).onDelete("cascade"),
  unique("sector_room_night_booking").on(t.organizationId,t.roomId,t.stayDate),index("sector_room_night_record").on(t.organizationId,t.recordId),
]);
