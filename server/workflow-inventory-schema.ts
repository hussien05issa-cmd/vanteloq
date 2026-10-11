import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex, check } from "drizzle-orm/sqlite-core";
import { workspaces, users, organizationLocations, purchaseOrders } from "../db/schema";

// Reference callbacks deliberately defer shared-schema lookup until schema construction.
export const workflowInventoryPositions = sqliteTable("workflow_inventory_positions", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull().references(() => organizationLocations.id), sku: text("sku").notNull(), productName: text("product_name").notNull(),
  unit: text("unit").notNull(), currency: text("currency").notNull(), quantityMilli: integer("quantity_milli").notNull(), version: integer("version").notNull().default(1),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, t => [uniqueIndex("workflow_inventory_position_key").on(t.organizationId, t.locationId, t.sku),
  check("workflow_inventory_position_valid", sql`${t.quantityMilli} >= 0 AND ${t.quantityMilli} <= 1000000000000 AND ${t.version} > 0 AND ${t.unit} IN ('each','g','ml')`)]);

export const workflowInventoryMovements = sqliteTable("workflow_inventory_movements", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  positionId: text("position_id").notNull().references(() => workflowInventoryPositions.id), quantityDelta: integer("quantity_delta").notNull(),
  reason: text("reason").notNull(), sourceReference: text("source_reference").notNull(), occurredDate: text("occurred_date").notNull(),
  actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }), createdAt: integer("created_at").notNull(),
}, t => [uniqueIndex("workflow_inventory_movement_source").on(t.organizationId, t.positionId, t.sourceReference), index("workflow_inventory_movement_history").on(t.organizationId, t.positionId, t.createdAt)]);

export const workflowInventoryReceipts = sqliteTable("workflow_inventory_receipts", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull().references(() => organizationLocations.id), purchaseOrderId: text("purchase_order_id").notNull().references(() => purchaseOrders.id),
  source: text("source").notNull(), occurredDate: text("occurred_date").notNull(), linesJson: text("lines_json").notNull(), reversedAt: integer("reversed_at"), reversalReason: text("reversal_reason"),
  actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }), createdAt: integer("created_at").notNull(),
}, t => [index("workflow_inventory_receipts_scope").on(t.organizationId, t.locationId, t.createdAt), check("workflow_inventory_receipts_json", sql`json_valid(${t.linesJson})`)]);

export const workflowInventoryRecords = sqliteTable("workflow_inventory_records", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull().references(() => organizationLocations.id), kind: text("kind").notNull(), recordKey: text("record_key").notNull(), currency: text("currency").notNull(),
  payloadJson: text("payload_json").notNull(), version: integer("version").notNull().default(1), actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }), updatedAt: integer("updated_at").notNull(),
}, t => [uniqueIndex("workflow_inventory_record_key").on(t.organizationId, t.locationId, t.kind, t.recordKey),
  check("workflow_inventory_record_valid", sql`json_valid(${t.payloadJson}) AND ${t.version}>0 AND ${t.kind} IN ('supplier','lot_case','returns','invoice_review')`)]);

export const workflowInventoryHistory = sqliteTable("workflow_inventory_history", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  recordId: text("record_id").notNull().references(() => workflowInventoryRecords.id, { onDelete: "cascade" }), version: integer("version").notNull(), payloadJson: text("payload_json").notNull(),
  actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }), createdAt: integer("created_at").notNull(),
}, t => [uniqueIndex("workflow_inventory_history_version").on(t.recordId,t.version), check("workflow_inventory_history_json", sql`json_valid(${t.payloadJson})`)]);

export const workflowInventoryMutations = sqliteTable("workflow_inventory_mutations", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  mutationKey: text("mutation_key").notNull(), requestHash: text("request_hash").notNull(), resultJson: text("result_json").notNull(), createdAt: integer("created_at").notNull(),
}, t => [uniqueIndex("workflow_inventory_mutation_key").on(t.organizationId,t.mutationKey), check("workflow_inventory_mutation_json", sql`json_valid(${t.resultJson})`)]);

export const workflowInventoryGuards = sqliteTable("workflow_inventory_guards", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), permitted: integer("permitted").notNull(),
}, t => [check("workflow_inventory_guard_passed", sql`${t.permitted}=1`)]);
