import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users, workspaces } from "./schema";
// Location IDs preserve history; deleting a user unassigns work and anonymizes credit names.
// Location ownership and delivery/reservation/credit guards are installed by the SQL migration.

export const dealershipVehicleIdentities = sqliteTable("dealership_vehicle_identities", {
  id: text("id").primaryKey().notNull(),
  organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  identifierKind: text("identifier_kind").notNull(),
  identifier: text("identifier").notNull(),
  modelYear: integer("model_year").notNull(),
  make: text("make").notNull(),
  model: text("model").notNull(),
  createdAt: integer("created_at").notNull(),
}, table => [
  unique().on(table.organizationId,table.id),
  unique().on(table.organizationId,table.identifier),
  check("dealership_vehicle_identities_check_1",sql`identifier_kind IN ('vin','legacy')`),
]);

export const dealershipStockEpisodes = sqliteTable("dealership_stock_episodes", {
  id: text("id").primaryKey().notNull(),
  organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  vehicleId: text("vehicle_id").notNull(),
  locationId: text("location_id").notNull(),
  locationName: text("location_name").notNull(),
  stockNumber: text("stock_number").notNull(),
  currency: text("currency").notNull(),
  acquiredDate: text("acquired_date").notNull(),
  ownership: text("ownership").notNull(),
  physicalStatus: text("physical_status").notNull(),
  prepStatus: text("prep_status").notNull(),
  availability: text("availability").notNull(),
  askingCents: integer("asking_cents"),
  costComplete: integer("cost_complete").notNull().default(0),
  isActive: integer("is_active").notNull().default(1),
  exitDate: text("exit_date"),
  source: text("source").notNull(),
  legacyVehicleId: text("legacy_vehicle_id"),
  legacyIncomplete: integer("legacy_incomplete").notNull().default(0),
  version: integer("version").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, table => [
  unique().on(table.organizationId,table.id),
  unique().on(table.organizationId,table.legacyVehicleId),
  foreignKey({columns:[table.organizationId,table.vehicleId],foreignColumns:[dealershipVehicleIdentities.organizationId,dealershipVehicleIdentities.id]}),
  check("dealership_stock_episodes_check_1",sql`length(currency)=3`),
  check("dealership_stock_episodes_check_2",sql`ownership IN ('owned','consignment','unknown')`),
  check("dealership_stock_episodes_check_3",sql`physical_status IN ('on_lot','offsite','in_transit','unknown')`),
  check("dealership_stock_episodes_check_4",sql`prep_status IN ('not_started','in_progress','ready','blocked','unknown')`),
  check("dealership_stock_episodes_check_5",sql`availability IN ('available','held','reserved','delivered','archived','legacy_sold')`),
  check("dealership_stock_episodes_check_6",sql`asking_cents IS NULL OR (typeof(asking_cents)='integer' AND asking_cents BETWEEN 0 AND 1000000000)`),
  check("dealership_stock_episodes_check_7",sql`cost_complete IN (0,1)`),
  check("dealership_stock_episodes_check_8",sql`is_active IN (0,1)`),
  check("dealership_stock_episodes_check_9",sql`source IN ('manual','csv','legacy')`),
  check("dealership_stock_episodes_check_10",sql`legacy_incomplete IN (0,1)`),
  check("dealership_stock_episodes_check_11",sql`version>0`),
  uniqueIndex("dealership_active_vehicle").on(table.organizationId,table.vehicleId).where(sql`is_active=1`),
  uniqueIndex("dealership_active_stock_number").on(table.organizationId,table.stockNumber).where(sql`is_active=1`),
  index("dealership_stock_scope").on(table.organizationId,table.locationId,table.id),
]);

export const dealershipCostLines = sqliteTable("dealership_cost_lines", {
  id: text("id").primaryKey().notNull(),
  organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  episodeId: text("episode_id").notNull(),
  category: text("category").notNull(),
  status: text("status").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  description: text("description").notNull(),
  sourceReference: text("source_reference").notNull().default(""),
  createdAt: integer("created_at").notNull(),
}, table => [
  unique().on(table.organizationId,table.id),
  foreignKey({columns:[table.organizationId,table.episodeId],foreignColumns:[dealershipStockEpisodes.organizationId,dealershipStockEpisodes.id]}),
  check("dealership_cost_lines_check_1",sql`category IN ('acquisition','auction','transport','preparation','other')`),
  check("dealership_cost_lines_check_2",sql`status IN ('recorded','estimated','approved','posted')`),
  check("dealership_cost_lines_check_3",sql`typeof(amount_cents)='integer' AND amount_cents BETWEEN 0 AND 1000000000`),
  index("dealership_cost_episode").on(table.organizationId,table.episodeId,table.status),
]);

export const dealershipLeads = sqliteTable("dealership_leads", {
  id: text("id").primaryKey().notNull(),
  organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull(),
  customerName: text("customer_name").notNull(),
  contact: text("contact").notNull().default(""),
  stage: text("stage").notNull(),
  assigneeId: text("assignee_id").references(() => users.id, { onDelete: "set null" }),
  nextActionDate: text("next_action_date"),
  version: integer("version").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, table => [
  unique().on(table.organizationId,table.id),
  check("dealership_leads_check_1",sql`stage IN ('new','contacted','appointment','negotiation','lost')`),
  check("dealership_leads_check_2",sql`version>0`),
  index("dealership_lead_scope").on(table.organizationId,table.locationId,table.id),
]);

export const dealershipTasks = sqliteTable("dealership_tasks", {
  id: text("id").primaryKey().notNull(),
  organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  episodeId: text("episode_id"),
  leadId: text("lead_id"),
  title: text("title").notNull(),
  status: text("status").notNull(),
  assigneeId: text("assignee_id").references(() => users.id, { onDelete: "set null" }),
  dueDate: text("due_date"),
  blockedReason: text("blocked_reason").notNull().default(""),
  version: integer("version").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, table => [
  unique().on(table.organizationId,table.id),
  foreignKey({columns:[table.organizationId,table.episodeId],foreignColumns:[dealershipStockEpisodes.organizationId,dealershipStockEpisodes.id]}),
  foreignKey({columns:[table.organizationId,table.leadId],foreignColumns:[dealershipLeads.organizationId,dealershipLeads.id]}),
  check("dealership_tasks_check_1",sql`status IN ('open','in_progress','blocked','done')`),
  check("dealership_tasks_check_2",sql`version>0`),
  check("dealership_tasks_check_3",sql`(episode_id IS NOT NULL AND lead_id IS NULL) OR (episode_id IS NULL AND lead_id IS NOT NULL)`),
  index("dealership_task_episode").on(table.organizationId,table.episodeId,table.status),
  index("dealership_task_lead").on(table.organizationId,table.leadId,table.status),
]);

export const dealershipAppointments = sqliteTable("dealership_appointments", {
  id: text("id").primaryKey().notNull(),
  organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  leadId: text("lead_id").notNull(),
  scheduledAt: text("scheduled_at").notNull(),
  status: text("status").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, table => [
  unique().on(table.organizationId,table.id),
  foreignKey({columns:[table.organizationId,table.leadId],foreignColumns:[dealershipLeads.organizationId,dealershipLeads.id]}),
  check("dealership_appointments_check_1",sql`status IN ('scheduled','attended','no_show','cancelled')`),
  check("dealership_appointments_check_2",sql`version>0`),
  index("dealership_appointment_lead").on(table.organizationId,table.leadId,table.scheduledAt),
]);

export const dealershipReservations = sqliteTable("dealership_reservations", {
  id: text("id").primaryKey().notNull(),
  organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  episodeId: text("episode_id").notNull(),
  leadId: text("lead_id"),
  expiresAt: text("expires_at").notNull(),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, table => [
  foreignKey({columns:[table.organizationId,table.episodeId],foreignColumns:[dealershipStockEpisodes.organizationId,dealershipStockEpisodes.id]}),
  foreignKey({columns:[table.organizationId,table.leadId],foreignColumns:[dealershipLeads.organizationId,dealershipLeads.id]}),
  check("dealership_reservations_check_1",sql`status IN ('active','released','expired','delivered')`),
  uniqueIndex("dealership_exclusive_reservation").on(table.organizationId,table.episodeId).where(sql`status='active'`),
]);

export const dealershipSales = sqliteTable("dealership_sales", {
  id: text("id").primaryKey().notNull(),
  organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  episodeId: text("episode_id").notNull(),
  locationId: text("location_id").notNull(),
  deliveredDate: text("delivered_date").notNull(),
  channel: text("channel").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  costCents: integer("cost_cents"),
  status: text("status").notNull().default("delivered"),
  reversalDate: text("reversal_date"),
  reversalReason: text("reversal_reason"),
  createdAt: integer("created_at").notNull(),
}, table => [
  unique().on(table.organizationId,table.id),
  unique().on(table.organizationId,table.episodeId),
  foreignKey({columns:[table.organizationId,table.episodeId],foreignColumns:[dealershipStockEpisodes.organizationId,dealershipStockEpisodes.id]}),
  check("dealership_sales_check_1",sql`channel IN ('retail','wholesale')`),
  check("dealership_sales_check_2",sql`typeof(amount_cents)='integer' AND amount_cents BETWEEN 0 AND 1000000000`),
  check("dealership_sales_check_3",sql`cost_cents IS NULL OR (typeof(cost_cents)='integer' AND cost_cents>=0)`),
  check("dealership_sales_check_4",sql`status IN ('delivered','reversed')`),
  index("dealership_sale_period").on(table.organizationId,table.locationId,table.deliveredDate),
]);

export const dealershipSaleCredits = sqliteTable("dealership_sale_credits", {
  id: text("id").primaryKey().notNull(),
  organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  saleId: text("sale_id").notNull(),
  personId: text("person_id").references(() => users.id, { onDelete: "set null" }),
  personName: text("person_name").notNull(),
  shareBps: integer("share_bps").notNull(),
  approvedBy: text("approved_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull(),
}, table => [
  unique().on(table.organizationId,table.saleId,table.personId),
  foreignKey({columns:[table.organizationId,table.saleId],foreignColumns:[dealershipSales.organizationId,dealershipSales.id]}),
  check("dealership_sale_credits_check_1",sql`typeof(share_bps)='integer' AND share_bps BETWEEN 1 AND 10000`),
]);

export const dealershipEvents = sqliteTable("dealership_events", {
  id: text("id").primaryKey().notNull(),
  organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  resourceId: text("resource_id").notNull(),
  action: text("action").notNull(),
  actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
  detailJson: text("detail_json").notNull(),
  createdAt: integer("created_at").notNull(),
}, table => [
  index("dealership_event_resource").on(table.organizationId,table.resourceId,table.createdAt),
]);

export const dealershipMutations = sqliteTable("dealership_mutations", {
  organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  mutationKey: text("mutation_key").notNull(),
  requestHash: text("request_hash").notNull(),
  resultJson: text("result_json").notNull(),
  createdAt: integer("created_at").notNull(),
}, table => [
  primaryKey({columns:[table.organizationId,table.mutationKey]}),
]);

export const dealershipWriteGuards = sqliteTable("dealership_write_guards", {
  id: text("id").primaryKey().notNull(),
  organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  permitted: integer("permitted").notNull(),
}, table => [
  check("dealership_write_guards_check_1",sql`permitted=1`),
]);

