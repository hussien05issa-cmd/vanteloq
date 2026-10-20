import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { organizationLocations, users, workspaces } from "./schema";

export const businessWorkflowRecords = sqliteTable("business_workflow_records", {
  id: text("id").primaryKey().notNull(),
  organizationId: text("organization_id").notNull().references(()=>workspaces.id,{onDelete:"cascade"}),
  locationId: text("location_id").notNull().references(()=>organizationLocations.id,{onDelete:"cascade"}),
  kind:text("kind").notNull(), name:text("name").notNull(), currency:text("currency").notNull(),
  state:text("state").notNull().default("draft"), contentJson:text("content_json").notNull(),
  version:integer("version").notNull().default(1), mutationId:text("mutation_id").notNull(),
  updatedBy:text("updated_by").references(()=>users.id,{onDelete:"set null"}), updatedAt:integer("updated_at").notNull(), createdAt:integer("created_at").notNull(),
}, t=>[index("business_workflow_scope").on(t.organizationId,t.locationId,t.kind,t.updatedAt),
  check("business_workflow_kind",sql`${t.kind} IN ('job','settlement','order_margin','outcome','custom')`),
  check("business_workflow_state",sql`${t.state} IN ('draft','reviewed','completed')`),check("business_workflow_json",sql`json_valid(${t.contentJson})`),check("business_workflow_version",sql`${t.version}>0`)]);
export const businessWorkflowRevisions = sqliteTable("business_workflow_revisions", {
  id:text("id").primaryKey().notNull(),organizationId:text("organization_id").notNull().references(()=>workspaces.id,{onDelete:"cascade"}),
  recordId:text("record_id").notNull().references(()=>businessWorkflowRecords.id,{onDelete:"cascade"}),version:integer("version").notNull(),
  requestId:text("request_id").notNull(),requestHash:text("request_hash").notNull(),actorId:text("actor_id").references(()=>users.id,{onDelete:"set null"}),
  action:text("action").notNull(),reason:text("reason").notNull().default(""),snapshotJson:text("snapshot_json").notNull(),recordedAt:integer("recorded_at").notNull(),
},t=>[unique("business_workflow_revision_number").on(t.recordId,t.version),unique("business_workflow_request").on(t.organizationId,t.requestId),index("business_workflow_history").on(t.organizationId,t.recordId,t.version),check("business_workflow_snapshot",sql`json_valid(${t.snapshotJson})`)]);
