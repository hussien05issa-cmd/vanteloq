import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Legacy prototype tables are retained so existing data is not destructively
// dropped by the first secure migration. Application routes no longer use them.
export const legacyTasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organizationId: text("organization_id").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("open"),
  assignee: text("assignee").notNull().default("Owner"),
  dueDate: text("due_date"),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const legacyOrganizations = sqliteTable("organizations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerEmail: text("owner_email").notNull().unique(),
  ownerName: text("owner_name").notNull(),
  businessName: text("business_name").notNull(),
  legalName: text("legal_name").notNull(),
  businessEmail: text("business_email").notNull(),
  phone: text("phone").notNull().default(""),
  website: text("website").notNull().default(""),
  industry: text("industry").notNull(),
  country: text("country").notNull().default("Canada"),
  province: text("province").notNull().default(""),
  city: text("city").notNull(),
  address: text("address").notNull(),
  postalCode: text("postal_code").notNull(),
  timezone: text("timezone").notNull().default("America/Toronto"),
  currency: text("currency").notNull().default("CAD"),
  fiscalYearStart: text("fiscal_year_start").notNull().default("January"),
  taxNumber: text("tax_number").notNull().default(""),
  hoursJson: text("hours_json").notNull(),
  sourceMode: text("source_mode").notNull().default("connect_later"),
  selectedPos: text("selected_pos").notNull().default(""),
  setupComplete: integer("setup_complete", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    check("users_status_check", sql`${table.status} in ('active', 'suspended')`),
  ],
);

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    ownerName: text("owner_name").notNull(),
    businessName: text("business_name").notNull(),
    legalName: text("legal_name").notNull(),
    businessEmail: text("business_email").notNull(),
    phone: text("phone").notNull().default(""),
    website: text("website").notNull().default(""),
    industry: text("industry").notNull(),
    country: text("country").notNull().default("Canada"),
    province: text("province").notNull().default(""),
    city: text("city").notNull(),
    address: text("address").notNull(),
    postalCode: text("postal_code").notNull(),
    timezone: text("timezone").notNull().default("America/Toronto"),
    currency: text("currency").notNull().default("CAD"),
    fiscalYearStart: text("fiscal_year_start").notNull().default("January"),
    taxNumber: text("tax_number").notNull().default(""),
    hoursJson: text("hours_json").notNull(),
    sourceMode: text("source_mode", { enum: ["connect_later", "csv", "live"] }).notNull().default("connect_later"),
    selectedPos: text("selected_pos").notNull().default(""),
    setupComplete: integer("setup_complete", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("workspaces_business_name_idx").on(table.businessName),
    check("workspaces_source_mode_check", sql`${table.sourceMode} in ('connect_later', 'csv', 'live')`),
  ],
);

export const memberships = sqliteTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "manager", "employee", "read_only", "integration"] }).notNull(),
    status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("memberships_user_unique").on(table.userId),
    uniqueIndex("memberships_user_workspace_unique").on(table.userId, table.organizationId),
    index("memberships_workspace_idx").on(table.organizationId),
    check("memberships_role_check", sql`${table.role} in ('owner', 'admin', 'manager', 'employee', 'read_only', 'integration')`),
    check("memberships_status_check", sql`${table.status} in ('active', 'suspended')`),
  ],
);

export const workspaceTasks = sqliteTable(
  "workspace_tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    priority: text("priority", { enum: ["high", "medium", "low"] }).notNull().default("medium"),
    status: text("status", { enum: ["open", "in_progress", "done"] }).notNull().default("open"),
    assignee: text("assignee").notNull().default("Owner"),
    dueDate: text("due_date"),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("workspace_tasks_idempotency_unique").on(table.organizationId, table.idempotencyKey),
    index("workspace_tasks_workspace_status_idx").on(table.organizationId, table.status),
    index("workspace_tasks_workspace_created_idx").on(table.organizationId, table.createdAt),
    check("workspace_tasks_priority_check", sql`${table.priority} in ('high', 'medium', 'low')`),
    check("workspace_tasks_status_check", sql`${table.status} in ('open', 'in_progress', 'done')`),
  ],
);

export const integrationConnections = sqliteTable(
  "integration_connections",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    status: text("status", { enum: ["not_connected", "pending", "connected", "error", "revoked"] }).notNull().default("not_connected"),
    externalAccountRef: text("external_account_ref"),
    scopesJson: text("scopes_json").notNull().default("[]"),
    lastSuccessfulSyncAt: integer("last_successful_sync_at", { mode: "timestamp" }),
    lastErrorCode: text("last_error_code"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("integration_connections_workspace_provider_unique").on(table.organizationId, table.provider),
    check("integration_connections_status_check", sql`${table.status} in ('not_connected', 'pending', 'connected', 'error', 'revoked')`),
  ],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => workspaces.id, { onDelete: "set null" }),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    outcome: text("outcome", { enum: ["success", "failure"] }).notNull(),
    requestId: text("request_id").notNull(),
    sourceHash: text("source_hash"),
    detailsJson: text("details_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("audit_events_workspace_created_idx").on(table.organizationId, table.createdAt),
    index("audit_events_actor_created_idx").on(table.actorUserId, table.createdAt),
    check("audit_events_outcome_check", sql`${table.outcome} in ('success', 'failure')`),
  ],
);

export const rateLimitBuckets = sqliteTable("rate_limit_buckets", {
  bucketKey: text("bucket_key").primaryKey(),
  scope: text("scope").notNull(),
  actorHash: text("actor_hash").notNull(),
  windowStart: integer("window_start").notNull(),
  requestCount: integer("request_count").notNull().default(1),
  expiresAt: integer("expires_at").notNull(),
});

