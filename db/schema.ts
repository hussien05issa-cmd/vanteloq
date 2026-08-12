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
    authSubject: text("auth_subject"),
    authProvider: text("auth_provider", { enum: ["supabase", "sites"] }),
    displayName: text("display_name").notNull(),
    status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_auth_subject_unique").on(table.authSubject),
    check("users_auth_provider_check", sql`${table.authProvider} is null or ${table.authProvider} in ('supabase','sites')`),
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

export const tenantSubscriptions = sqliteTable(
  "tenant_subscriptions",
  {
    organizationId: text("organization_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
    basePlan: text("base_plan", { enum: ["starter", "growth", "pro"] }),
    billingInterval: text("billing_interval", { enum: ["month", "year"] }),
    status: text("status", {
      enum: ["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"],
    }).notNull().default("incomplete"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeBasePriceId: text("stripe_base_price_id"),
    trialEndsAt: integer("trial_ends_at", { mode: "timestamp" }),
    currentPeriodEndsAt: integer("current_period_ends_at", { mode: "timestamp" }),
    cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }).notNull().default(false),
    scheduledBasePlan: text("scheduled_base_plan", { enum: ["starter", "growth", "pro"] }),
    scheduledBillingInterval: text("scheduled_billing_interval", { enum: ["month", "year"] }),
    scheduledEffectiveAt: integer("scheduled_effective_at", { mode: "timestamp" }),
    lastStripeEventId: text("last_stripe_event_id"),
    lastStripeEventCreatedAt: integer("last_stripe_event_created_at", { mode: "timestamp" }),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("tenant_subscriptions_customer_unique").on(table.stripeCustomerId),
    uniqueIndex("tenant_subscriptions_subscription_unique").on(table.stripeSubscriptionId),
    index("tenant_subscriptions_status_idx").on(table.status, table.updatedAt),
    check("tenant_subscriptions_plan_check", sql`${table.basePlan} is null or ${table.basePlan} in ('starter','growth','pro')`),
    check("tenant_subscriptions_interval_check", sql`${table.billingInterval} is null or ${table.billingInterval} in ('month','year')`),
    check("tenant_subscriptions_status_check", sql`${table.status} in ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')`),
    check("tenant_subscriptions_scheduled_plan_check", sql`${table.scheduledBasePlan} is null or ${table.scheduledBasePlan} in ('starter','growth','pro')`),
    check("tenant_subscriptions_scheduled_interval_check", sql`${table.scheduledBillingInterval} is null or ${table.scheduledBillingInterval} in ('month','year')`),
    check("tenant_subscriptions_version_check", sql`${table.version} >= 1`),
  ],
);

export const tenantAddons = sqliteTable(
  "tenant_addons",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    addonKey: text("addon_key", { enum: ["bookloq"] }).notNull(),
    status: text("status", { enum: ["trialing", "active", "scheduled_for_removal", "inactive"] }).notNull(),
    stripeSubscriptionItemId: text("stripe_subscription_item_id"),
    stripePriceId: text("stripe_price_id"),
    currentPeriodEndsAt: integer("current_period_ends_at", { mode: "timestamp" }),
    scheduledRemovalAt: integer("scheduled_removal_at", { mode: "timestamp" }),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("tenant_addons_key_unique").on(table.organizationId, table.addonKey),
    uniqueIndex("tenant_addons_item_unique").on(table.stripeSubscriptionItemId),
    index("tenant_addons_status_idx").on(table.organizationId, table.status),
    check("tenant_addons_key_check", sql`${table.addonKey} in ('bookloq')`),
    check("tenant_addons_status_check", sql`${table.status} in ('trialing','active','scheduled_for_removal','inactive')`),
  ],
);

export const stripeBillingEvents = sqliteTable(
  "stripe_billing_events",
  {
    eventId: text("event_id").primaryKey(),
    organizationId: text("organization_id").references(() => workspaces.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    stripeCreatedAt: integer("stripe_created_at", { mode: "timestamp" }).notNull(),
    payloadHash: text("payload_hash").notNull(),
    status: text("status", { enum: ["received", "processing", "processed", "failed", "ignored"] }).notNull().default("received"),
    errorCode: text("error_code"),
    receivedAt: integer("received_at", { mode: "timestamp" }).notNull(),
    processedAt: integer("processed_at", { mode: "timestamp" }),
  },
  (table) => [
    index("stripe_billing_events_workspace_created_idx").on(table.organizationId, table.stripeCreatedAt),
    index("stripe_billing_events_status_idx").on(table.status, table.receivedAt),
    check("stripe_billing_events_status_check", sql`${table.status} in ('received','processing','processed','failed','ignored')`),
  ],
);

export const internalAccess = sqliteTable(
  "internal_access",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    accessLevel: text("access_level", { enum: ["founder"] }).notNull(),
    reason: text("reason").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    mfaRequired: integer("mfa_required", { mode: "boolean" }).notNull().default(true),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("internal_access_user_workspace_level_unique").on(table.userId, table.organizationId, table.accessLevel),
    index("internal_access_workspace_active_idx").on(table.organizationId, table.active),
    check("internal_access_level_check", sql`${table.accessLevel} in ('founder')`),
    check("internal_access_reason_check", sql`length(${table.reason}) between 3 and 500`),
  ],
);

export const accountPreferences = sqliteTable("account_preferences", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  emailNotifications: integer("email_notifications", { mode: "boolean" }).notNull().default(true),
  rememberedProfile: integer("remembered_profile", { mode: "boolean" }).notNull().default(true),
  hiddenNavigationJson: text("hidden_navigation_json").notNull().default("[]"),
  preferredLocationId: text("preferred_location_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const accountNotifications = sqliteTable("account_notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").references(() => workspaces.id, { onDelete: "cascade" }),
  notificationType: text("notification_type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  deliveryStatus: text("delivery_status", { enum: ["in_app", "queued", "sent", "failed"] }).notNull().default("in_app"),
  readAt: integer("read_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  index("account_notifications_user_created_idx").on(table.userId, table.createdAt),
  check("account_notifications_delivery_check", sql`${table.deliveryStatus} in ('in_app', 'queued', 'sent', 'failed')`),
]);

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
    sourceType: text("source_type", { enum: ["manual", "insight", "alert", "decision"] }).notNull().default("manual"),
    sourceRef: text("source_ref"),
    expectedImpact: text("expected_impact").notNull().default(""),
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
    check("workspace_tasks_source_type_check", sql`${table.sourceType} in ('manual', 'insight', 'alert', 'decision')`),
  ],
);

export const dataImports = sqliteTable(
  "data_imports",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    importType: text("import_type", { enum: ["daily_summary_csv", "manual_entry"] }).notNull(),
    status: text("status", { enum: ["processing", "completed", "failed"] }).notNull(),
    fileName: text("file_name").notNull().default(""),
    rowCount: integer("row_count").notNull().default(0),
    idempotencyKey: text("idempotency_key").notNull(),
    importedByUserId: text("imported_by_user_id").notNull().references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("data_imports_workspace_idempotency_unique").on(table.organizationId, table.idempotencyKey),
    index("data_imports_workspace_created_idx").on(table.organizationId, table.createdAt),
    check("data_imports_type_check", sql`${table.importType} in ('daily_summary_csv', 'manual_entry')`),
    check("data_imports_status_check", sql`${table.status} in ('processing', 'completed', 'failed')`),
    check("data_imports_row_count_check", sql`${table.rowCount} >= 0`),
  ],
);

export const dailyBusinessMetrics = sqliteTable(
  "daily_business_metrics",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    businessDate: text("business_date").notNull(),
    locationRef: text("location_ref").notNull().default("all"),
    grossSalesCents: integer("gross_sales_cents").notNull(),
    netSalesCents: integer("net_sales_cents").notNull(),
    costOfGoodsCents: integer("cost_of_goods_cents").notNull(),
    transactionCount: integer("transaction_count").notNull(),
    unitsSold: integer("units_sold").notNull(),
    refundsCents: integer("refunds_cents").notNull().default(0),
    discountsCents: integer("discounts_cents").notNull().default(0),
    labourCostCents: integer("labour_cost_cents").notNull().default(0),
    inventoryValueCents: integer("inventory_value_cents"),
    cashBalanceCents: integer("cash_balance_cents"),
    accountsPayableCents: integer("accounts_payable_cents"),
    // Connector facts retain their publication owner. Manual/imported rows keep
    // these fields null so a revoked or staging connection cannot be mistaken
    // for owner-entered data after the provider row is hidden.
    sourceProvider: text("source_provider"),
    sourceConnectionId: text("source_connection_id"),
    sourceImportId: text("source_import_id").references(() => dataImports.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("daily_metrics_workspace_date_location_unique").on(table.organizationId, table.businessDate, table.locationRef),
    index("daily_metrics_workspace_date_idx").on(table.organizationId, table.businessDate),
    index("daily_metrics_workspace_source_idx").on(table.organizationId, table.sourceConnectionId),
    check("daily_metrics_nonnegative_amounts_check", sql`${table.grossSalesCents} >= 0 and ${table.netSalesCents} >= 0 and ${table.costOfGoodsCents} >= 0 and ${table.refundsCents} >= 0 and ${table.discountsCents} >= 0 and ${table.labourCostCents} >= 0`),
    check("daily_metrics_nonnegative_counts_check", sql`${table.transactionCount} >= 0 and ${table.unitsSold} >= 0`),
  ],
);

export const growthTouchpoints = sqliteTable(
  "growth_touchpoints",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    occurredAt: text("occurred_at").notNull(),
    source: text("source").notNull(),
    stage: text("stage", { enum: ["discovery", "website", "phone_call", "lead", "customer"] }).notNull(),
    journeyRef: text("journey_ref").notNull(),
    sourceSystem: text("source_system").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("growth_touchpoints_source_event_unique").on(table.organizationId, table.sourceSystem, table.sourceEventId),
    index("growth_touchpoints_journey_idx").on(table.organizationId, table.journeyRef, table.occurredAt),
    check("growth_touchpoints_stage_check", sql`${table.stage} in ('discovery','website','phone_call','lead','customer')`),
  ],
);

export const growthTransactions = sqliteTable(
  "growth_transactions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    occurredAt: text("occurred_at").notNull(),
    journeyRef: text("journey_ref").notNull(),
    revenueCents: integer("revenue_cents").notNull(),
    grossProfitCents: integer("gross_profit_cents"),
    sourceSystem: text("source_system").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("growth_transactions_source_event_unique").on(table.organizationId, table.sourceSystem, table.sourceEventId),
    index("growth_transactions_journey_idx").on(table.organizationId, table.journeyRef, table.occurredAt),
    check("growth_transactions_amount_check", sql`${table.revenueCents} >= 0 and (${table.grossProfitCents} is null or ${table.grossProfitCents} <= ${table.revenueCents})`),
  ],
);

export const searchVisibilityObservations = sqliteTable(
  "search_visibility_observations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
    observedDate: text("observed_date").notNull(),
    positionMilli: integer("position_milli").notNull(),
    discoveryActions: integer("discovery_actions"),
    sourceSystem: text("source_system").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("search_visibility_source_event_unique").on(table.organizationId, table.sourceSystem, table.sourceEventId),
    index("search_visibility_query_date_idx").on(table.organizationId, table.query, table.observedDate),
    check("search_visibility_position_check", sql`${table.positionMilli} > 0`),
    check("search_visibility_actions_check", sql`${table.discoveryActions} is null or ${table.discoveryActions} >= 0`),
  ],
);

export const marketingProfiles = sqliteTable(
  "marketing_profiles",
  {
    organizationId: text("organization_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
    businessModel: text("business_model").notNull().default(""),
    primaryOffer: text("primary_offer").notNull().default(""),
    targetAudience: text("target_audience").notNull().default(""),
    serviceArea: text("service_area").notNull().default(""),
    primaryGoal: text("primary_goal", { enum: ["leads", "visits", "sales", "awareness"] }).notNull().default("leads"),
    websiteUrl: text("website_url").notNull().default(""),
    googleProfileStatus: text("google_profile_status", { enum: ["not_set", "claimed", "verified"] }).notNull().default("not_set"),
    notes: text("notes").notNull().default(""),
    updatedByUserId: text("updated_by_user_id").notNull().references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    check("marketing_profiles_goal_check", sql`${table.primaryGoal} in ('leads','visits','sales','awareness')`),
    check("marketing_profiles_google_check", sql`${table.googleProfileStatus} in ('not_set','claimed','verified')`),
  ],
);

export const marketingCalendarEntries = sqliteTable(
  "marketing_calendar_entries",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    channel: text("channel", { enum: ["content", "google", "meta", "email", "local", "website"] }).notNull(),
    eventType: text("event_type", { enum: ["campaign", "content", "audit", "offer", "follow_up"] }).notNull(),
    startDate: text("start_date").notNull(),
    dueDate: text("due_date"),
    status: text("status", { enum: ["planned", "in_progress", "completed", "cancelled"] }).notNull().default("planned"),
    objective: text("objective").notNull().default(""),
    notes: text("notes").notNull().default(""),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("marketing_calendar_workspace_date_idx").on(table.organizationId, table.startDate),
    check("marketing_calendar_status_check", sql`${table.status} in ('planned','in_progress','completed','cancelled')`),
  ],
);

export const businessEvents = sqliteTable(
  "business_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    eventType: text("event_type", { enum: ["decision", "promotion", "hours", "staffing", "supplier_price", "stockout", "competitor", "construction", "other"] }).notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    eventDate: text("event_date").notNull(),
    expectedOutcome: text("expected_outcome").notNull().default(""),
    reviewDate: text("review_date"),
    status: text("status", { enum: ["active", "reviewed"] }).notNull().default("active"),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("business_events_workspace_date_idx").on(table.organizationId, table.eventDate),
    check("business_events_type_check", sql`${table.eventType} in ('decision', 'promotion', 'hours', 'staffing', 'supplier_price', 'stockout', 'competitor', 'construction', 'other')`),
    check("business_events_status_check", sql`${table.status} in ('active', 'reviewed')`),
  ],
);

// The operational event log is the durable contract between connected systems
// and the Vanteloq UI. Provider webhooks are acknowledged only after an event is
// persisted; projections and outbound work can then be retried independently.
export const operationalEvents = sqliteTable(
  "operational_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    eventType: text("event_type", { enum: ["payment.settled", "inventory.depleted", "message.queued", "message.sent", "message.failed"] }).notNull(),
    aggregateType: text("aggregate_type", { enum: ["sale", "inventory", "message"] }).notNull(),
    aggregateId: text("aggregate_id").notNull(),
    sourceSystem: text("source_system").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    payloadJson: text("payload_json").notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp" }).notNull(),
    recordedAt: integer("recorded_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("operational_events_source_unique").on(table.organizationId, table.sourceSystem, table.sourceEventId, table.eventType),
    index("operational_events_workspace_cursor_idx").on(table.organizationId, table.recordedAt, table.id),
    check("operational_events_type_check", sql`${table.eventType} in ('payment.settled', 'inventory.depleted', 'message.queued', 'message.sent', 'message.failed')`),
    check("operational_events_aggregate_check", sql`${table.aggregateType} in ('sale', 'inventory', 'message')`),
  ],
);

export const inventoryBalances = sqliteTable(
  "inventory_balances",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    locationRef: text("location_ref").notNull(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    onHandQuantity: integer("on_hand_quantity").notNull().default(0),
    reorderPoint: integer("reorder_point").notNull().default(0),
    version: integer("version").notNull().default(1),
    sourceProvider: text("source_provider"),
    sourceConnectionId: text("source_connection_id"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("inventory_balances_workspace_location_sku_unique").on(table.organizationId, table.locationRef, table.sku),
    index("inventory_balances_workspace_stock_idx").on(table.organizationId, table.onHandQuantity),
    index("inventory_balances_workspace_source_idx").on(table.organizationId, table.sourceConnectionId),
    check("inventory_balances_reorder_check", sql`${table.reorderPoint} >= 0`),
  ],
);

export const inventoryMovements = sqliteTable(
  "inventory_movements",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    operationalEventId: text("operational_event_id").notNull().references(() => operationalEvents.id, { onDelete: "cascade" }),
    locationRef: text("location_ref").notNull(),
    sku: text("sku").notNull(),
    itemName: text("item_name").notNull(),
    quantityDelta: integer("quantity_delta").notNull(),
    reason: text("reason", { enum: ["sale", "refund", "receipt", "adjustment"] }).notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("inventory_movements_event_sku_unique").on(table.operationalEventId, table.locationRef, table.sku),
    index("inventory_movements_workspace_sku_idx").on(table.organizationId, table.sku, table.occurredAt),
    check("inventory_movements_nonzero_check", sql`${table.quantityDelta} <> 0`),
    check("inventory_movements_reason_check", sql`${table.reason} in ('sale', 'refund', 'receipt', 'adjustment')`),
  ],
);

// Lots are an optional lifecycle layer over the canonical SKU/location balance.
// POS adapters continue to write normalized inventory movements; products that
// need batch, shelf-life, or supplier traceability opt into these records.
export const inventoryLots = sqliteTable(
  "inventory_lots",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    locationRef: text("location_ref").notNull(),
    sku: text("sku").notNull(),
    productName: text("product_name").notNull(),
    supplierName: text("supplier_name"),
    lotNumber: text("lot_number").notNull().default(""),
    batchNumber: text("batch_number").notNull().default(""),
    manufacturingDate: text("manufacturing_date"),
    receivedDate: text("received_date").notNull(),
    expirationDate: text("expiration_date"),
    bestBeforeDate: text("best_before_date"),
    shelfLifeDays: integer("shelf_life_days"),
    unitCostCents: integer("unit_cost_cents"),
    unitRetailCents: integer("unit_retail_cents"),
    quantityReceived: integer("quantity_received").notNull(),
    quantityRemaining: integer("quantity_remaining").notNull(),
    storageNotes: text("storage_notes").notNull().default(""),
    status: text("status", { enum: ["active", "quarantined", "depleted", "expired"] }).notNull().default("active"),
    sourceSystem: text("source_system", { enum: ["manual", "purchase_order", "pos", "import"] }).notNull().default("manual"),
    sourceRef: text("source_ref"),
    version: integer("version").notNull().default(1),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
    updatedByUserId: text("updated_by_user_id").notNull().references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("inventory_lots_identity_unique").on(table.organizationId, table.locationRef, table.sku, table.lotNumber, table.batchNumber, table.receivedDate),
    index("inventory_lots_fefo_idx").on(table.organizationId, table.locationRef, table.sku, table.expirationDate, table.bestBeforeDate),
    index("inventory_lots_risk_idx").on(table.organizationId, table.status, table.expirationDate, table.bestBeforeDate),
    check("inventory_lots_quantity_check", sql`${table.quantityReceived} >= 0 and ${table.quantityRemaining} >= 0`),
    check("inventory_lots_money_check", sql`${table.unitCostCents} is null or ${table.unitCostCents} >= 0`),
    check("inventory_lots_retail_check", sql`${table.unitRetailCents} is null or ${table.unitRetailCents} >= 0`),
    check("inventory_lots_shelf_life_check", sql`${table.shelfLifeDays} is null or ${table.shelfLifeDays} > 0`),
    check("inventory_lots_version_check", sql`${table.version} > 0`),
    check("inventory_lots_status_check", sql`${table.status} in ('active', 'quarantined', 'depleted', 'expired')`),
    check("inventory_lots_source_check", sql`${table.sourceSystem} in ('manual', 'purchase_order', 'pos', 'import')`),
  ],
);

export const inventoryLotMovements = sqliteTable(
  "inventory_lot_movements",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    lotId: text("lot_id").notNull().references(() => inventoryLots.id, { onDelete: "cascade" }),
    operationalEventId: text("operational_event_id").references(() => operationalEvents.id, { onDelete: "set null" }),
    quantityDelta: integer("quantity_delta").notNull(),
    reason: text("reason", { enum: ["receipt", "sale", "refund", "adjustment", "transfer_in", "transfer_out", "waste", "expiry"] }).notNull(),
    notes: text("notes").notNull().default(""),
    occurredAt: integer("occurred_at", { mode: "timestamp" }).notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("inventory_lot_movements_event_unique").on(table.organizationId, table.operationalEventId, table.lotId, table.reason),
    index("inventory_lot_movements_lot_time_idx").on(table.organizationId, table.lotId, table.occurredAt),
    check("inventory_lot_movements_nonzero_check", sql`${table.quantityDelta} <> 0`),
    check("inventory_lot_movements_reason_check", sql`${table.reason} in ('receipt', 'sale', 'refund', 'adjustment', 'transfer_in', 'transfer_out', 'waste', 'expiry')`),
  ],
);

export const outboundMessages = sqliteTable(
  "outbound_messages",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    operationalEventId: text("operational_event_id").notNull().references(() => operationalEvents.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: ["email"] }).notNull().default("email"),
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    status: text("status", { enum: ["held", "queued", "sending", "sent", "failed"] }).notNull().default("held"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }),
    providerMessageRef: text("provider_message_ref"),
    lastErrorCode: text("last_error_code"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("outbound_messages_event_channel_unique").on(table.operationalEventId, table.channel),
    index("outbound_messages_workspace_status_idx").on(table.organizationId, table.status, table.nextAttemptAt),
    check("outbound_messages_status_check", sql`${table.status} in ('held', 'queued', 'sending', 'sent', 'failed')`),
    check("outbound_messages_attempt_check", sql`${table.attemptCount} >= 0 and ${table.attemptCount} <= 20`),
  ],
);

export const integrationConnections = sqliteTable(
  "integration_connections",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    sourceNamespace: text("source_namespace").notNull().default("legacy"),
    status: text("status", { enum: ["not_connected", "pending", "connected", "error", "revoked"] }).notNull().default("not_connected"),
    externalAccountRef: text("external_account_ref"),
    externalAccountName: text("external_account_name"),
    domainPrefix: text("domain_prefix"),
    apiVersion: text("api_version"),
    scopesJson: text("scopes_json").notNull().default("[]"),
    dataPromotionStatus: text("data_promotion_status", { enum: ["blocked", "staging", "approved"] }).notNull().default("blocked"),
    promotionAuthorizedAt: integer("promotion_authorized_at", { mode: "timestamp" }),
    connectedAt: integer("connected_at", { mode: "timestamp" }),
    lastSuccessfulSyncAt: integer("last_successful_sync_at", { mode: "timestamp" }),
    lastSyncCursor: text("last_sync_cursor"),
    lastErrorCode: text("last_error_code"),
    syncLeaseOwner: text("sync_lease_owner"),
    syncLeaseExpiresAt: integer("sync_lease_expires_at", { mode: "timestamp" }),
    syncVersion: integer("sync_version").notNull().default(0),
    resourceSelectionVersion: integer("resource_selection_version").notNull().default(0),
    privacyDataDeletedAt: integer("privacy_data_deleted_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("integration_connections_workspace_provider_idx").on(table.organizationId, table.provider),
    uniqueIndex("integration_connections_workspace_account_unique").on(table.organizationId, table.provider, table.externalAccountRef),
    uniqueIndex("integration_connections_workspace_namespace_unique").on(table.organizationId, table.provider, table.sourceNamespace),
    uniqueIndex("integration_connections_provider_domain_unique").on(table.provider, table.domainPrefix),
    uniqueIndex("integration_connections_provider_external_account_unique").on(table.provider, table.externalAccountRef),
    check("integration_connections_status_check", sql`${table.status} in ('not_connected', 'pending', 'connected', 'error', 'revoked')`),
    check("integration_connections_promotion_check", sql`${table.dataPromotionStatus} in ('blocked', 'staging', 'approved')`),
  ],
);

export const marketingResourceSelections = sqliteTable(
  "marketing_resource_selections",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").notNull().references(() => integrationConnections.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["google", "meta"] }).notNull(),
    dataset: text("dataset", { enum: ["google_analytics", "google_search_console", "meta_ads"] }).notNull(),
    externalResourceRef: text("external_resource_ref").notNull(),
    externalResourceName: text("external_resource_name").notNull(),
    scopeKind: text("scope_kind", { enum: ["organization", "location"] }).notNull(),
    localLocationId: text("local_location_id").references(() => organizationLocations.id, { onDelete: "restrict" }),
    selectedByUserId: text("selected_by_user_id").notNull().references(() => users.id),
    selectedAt: integer("selected_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("marketing_resource_selections_resource_unique").on(table.organizationId, table.connectionId, table.dataset, table.externalResourceRef),
    index("marketing_resource_selections_connection_idx").on(table.organizationId, table.connectionId),
    index("marketing_resource_selections_location_idx").on(table.organizationId, table.localLocationId),
    check("marketing_resource_selections_provider_check", sql`${table.provider} in ('google','meta')`),
    check("marketing_resource_selections_dataset_check", sql`${table.dataset} in ('google_analytics','google_search_console','meta_ads')`),
    check("marketing_resource_selections_pair_check", sql`((${table.provider} = 'google' and ${table.dataset} in ('google_analytics','google_search_console')) or (${table.provider} = 'meta' and ${table.dataset} = 'meta_ads'))`),
    check("marketing_resource_selections_scope_check", sql`((${table.scopeKind} = 'organization' and ${table.localLocationId} is null) or (${table.scopeKind} = 'location' and ${table.localLocationId} is not null))`),
  ],
);

// Daily measurement lineage is derived from the required, owner-selected
// provider resource rather than duplicated free-form provider references.
export const marketingDailyMetrics = sqliteTable(
  "marketing_daily_metrics",
  {
    id: text("id").primaryKey(),
    resourceSelectionId: text("resource_selection_id").notNull().references(() => marketingResourceSelections.id, { onDelete: "cascade" }),
    metricDate: text("metric_date").notNull(),
    metricKey: text("metric_key").notNull(),
    valueMilli: integer("value_milli").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("marketing_daily_metrics_source_unique").on(table.resourceSelectionId, table.sourceEventId),
    index("marketing_daily_metrics_selection_date_idx").on(table.resourceSelectionId, table.metricDate, table.metricKey),
    check("marketing_daily_metrics_value_check", sql`${table.valueMilli} >= 0`),
  ],
);

// Provider tokens are isolated from connection metadata so routine status
// queries cannot accidentally select or serialize credential material.
export const integrationSecrets = sqliteTable(
  "integration_secrets",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    connectionId: text("connection_id").notNull().default("legacy"),
    accessTokenCiphertext: text("access_token_ciphertext").notNull(),
    refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
    tokenExpiresAt: integer("token_expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("integration_secrets_connection_unique").on(table.connectionId),
    index("integration_secrets_workspace_provider_idx").on(table.organizationId, table.provider),
    index("integration_secrets_expiry_idx").on(table.provider, table.tokenExpiresAt),
  ],
);

// Versioned, tenant-scoped evidence that an authenticated user accepted the
// provider-specific notice before an authorization session was issued. The
// record deliberately stores identifiers and policy versions, not bank data.
export const integrationConsents = sqliteTable(
  "integration_consents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").notNull(),
    provider: text("provider").notNull(),
    status: text("status", { enum: ["accepted", "withdrawn", "expired"] }).notNull().default("accepted"),
    noticeVersion: text("notice_version").notNull(),
    privacyPolicyVersion: text("privacy_policy_version").notNull(),
    dataCategoriesJson: text("data_categories_json").notNull(),
    purposesJson: text("purposes_json").notNull(),
    consentSource: text("consent_source").notNull().default("in_app"),
    acceptedAt: integer("accepted_at", { mode: "timestamp" }).notNull(),
    withdrawnAt: integer("withdrawn_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("integration_consents_workspace_provider_status_idx").on(table.organizationId, table.provider, table.status, table.acceptedAt),
    index("integration_consents_actor_idx").on(table.actorUserId, table.acceptedAt),
    check("integration_consents_status_check", sql`${table.status} in ('accepted', 'withdrawn', 'expired')`),
    check("integration_consents_source_check", sql`${table.consentSource} in ('in_app')`),
  ],
);

export const integrationOAuthStates = sqliteTable(
  "integration_oauth_states",
  {
    stateHash: text("state_hash").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    connectionId: text("connection_id").notNull().default("legacy"),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    consumedAt: integer("consumed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("integration_oauth_states_expiry_idx").on(table.provider, table.expiresAt)],
);

export const integrationLocationMappings = sqliteTable(
  "integration_location_mappings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    connectionId: text("connection_id").notNull().default("legacy"),
    externalLocationRef: text("external_location_ref").notNull(),
    externalName: text("external_name").notNull(),
    // The mapping is tenant-scoped in application queries. It stays nullable so
    // outlet discovery can complete before a local location is selected.
    localLocationId: text("local_location_id"),
    status: text("status", { enum: ["unmapped", "mapped", "ignored"] }).notNull().default("unmapped"),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("integration_location_mappings_external_unique").on(table.organizationId, table.provider, table.connectionId, table.externalLocationRef),
    index("integration_location_mappings_status_idx").on(table.organizationId, table.provider, table.connectionId, table.status),
    check("integration_location_mappings_status_check", sql`${table.status} in ('unmapped', 'mapped', 'ignored')`),
  ],
);

export const integrationSyncRuns = sqliteTable(
  "integration_sync_runs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    connectionId: text("connection_id").notNull().default("legacy"),
    mode: text("mode", { enum: ["discovery", "sample", "incremental", "webhook_recovery"] }).notNull(),
    status: text("status", { enum: ["running", "completed", "failed"] }).notNull(),
    cursorBefore: text("cursor_before"),
    cursorAfter: text("cursor_after"),
    recordsRead: integer("records_read").notNull().default(0),
    recordsStaged: integer("records_staged").notNull().default(0),
    duplicatesSkipped: integer("duplicates_skipped").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0),
    errorCode: text("error_code"),
    resourceSelectionVersion: integer("resource_selection_version"),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    index("integration_sync_runs_workspace_provider_idx").on(table.organizationId, table.provider, table.connectionId, table.startedAt),
    check("integration_sync_runs_mode_check", sql`${table.mode} in ('discovery', 'sample', 'incremental', 'webhook_recovery')`),
    check("integration_sync_runs_status_check", sql`${table.status} in ('running', 'completed', 'failed')`),
  ],
);

export const integrationStagedSales = sqliteTable(
  "integration_staged_sales",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    connectionId: text("connection_id").notNull().default("legacy"),
    externalSaleId: text("external_sale_id").notNull(),
    externalVersion: text("external_version").notNull(),
    outletRef: text("outlet_ref"),
    soldAt: text("sold_at"),
    state: text("state").notNull(),
    totalCents: integer("total_cents").notNull(),
    taxCents: integer("tax_cents").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    discountCents: integer("discount_cents").notNull().default(0),
    lineCount: integer("line_count").notNull().default(0),
    sourcePayloadHash: text("source_payload_hash").notNull(),
    syncRunId: text("sync_run_id").notNull().references(() => integrationSyncRuns.id, { onDelete: "cascade" }),
    stagedAt: integer("staged_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("integration_staged_sales_version_unique").on(table.organizationId, table.provider, table.connectionId, table.externalSaleId, table.externalVersion),
    index("integration_staged_sales_outlet_date_idx").on(table.organizationId, table.provider, table.connectionId, table.outletRef, table.soldAt),
    check("integration_staged_sales_counts_check", sql`${table.lineCount} >= 0`),
  ],
);

// Canonical commerce records are provider-neutral so every POS adapter can
// feed the same tenant-scoped customer, catalog, supplier and reporting views.
// Only fields required by the product are retained; raw provider payloads and
// credentials never enter these tables.
export const commerceProducts = sqliteTable(
  "commerce_products",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    connectionId: text("connection_id").notNull().default("legacy"),
    externalProductId: text("external_product_id").notNull(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    categoryRef: text("category_ref"),
    supplierRef: text("supplier_ref"),
    defaultCostCents: integer("default_cost_cents"),
    defaultPriceCents: integer("default_price_cents"),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    sourceUpdatedAt: text("source_updated_at"),
    sourcePayloadHash: text("source_payload_hash").notNull(),
    syncRunId: text("sync_run_id").notNull().references(() => integrationSyncRuns.id, { onDelete: "cascade" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("commerce_products_external_unique").on(table.organizationId, table.provider, table.connectionId, table.externalProductId),
    index("commerce_products_sku_idx").on(table.organizationId, table.sku),
    index("commerce_products_supplier_idx").on(table.organizationId, table.provider, table.supplierRef),
  ],
);

export const commerceCustomers = sqliteTable(
  "commerce_customers",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    connectionId: text("connection_id").notNull().default("legacy"),
    externalCustomerId: text("external_customer_id").notNull(),
    displayName: text("display_name").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    email: text("email"),
    phone: text("phone"),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    sourceUpdatedAt: text("source_updated_at"),
    sourcePayloadHash: text("source_payload_hash").notNull(),
    syncRunId: text("sync_run_id").notNull().references(() => integrationSyncRuns.id, { onDelete: "cascade" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("commerce_customers_external_unique").on(table.organizationId, table.provider, table.connectionId, table.externalCustomerId),
    index("commerce_customers_name_idx").on(table.organizationId, table.displayName),
  ],
);

export const commerceSuppliers = sqliteTable(
  "commerce_suppliers",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    connectionId: text("connection_id").notNull().default("legacy"),
    externalSupplierId: text("external_supplier_id").notNull(),
    name: text("name").notNull(),
    accountNumber: text("account_number"),
    contactName: text("contact_name"),
    email: text("email"),
    phone: text("phone"),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    sourceUpdatedAt: text("source_updated_at"),
    sourcePayloadHash: text("source_payload_hash").notNull(),
    syncRunId: text("sync_run_id").notNull().references(() => integrationSyncRuns.id, { onDelete: "cascade" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("commerce_suppliers_external_unique").on(table.organizationId, table.provider, table.connectionId, table.externalSupplierId),
    index("commerce_suppliers_name_idx").on(table.organizationId, table.name),
  ],
);

export const commerceSaleLines = sqliteTable(
  "commerce_sale_lines",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    connectionId: text("connection_id").notNull().default("legacy"),
    externalSaleId: text("external_sale_id").notNull(),
    externalLineId: text("external_line_id").notNull(),
    productRef: text("product_ref"),
    customerRef: text("customer_ref"),
    outletRef: text("outlet_ref"),
    soldAt: text("sold_at"),
    sku: text("sku"),
    productName: text("product_name"),
    quantityMilli: integer("quantity_milli").notNull().default(0),
    netSalesCents: integer("net_sales_cents").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    discountCents: integer("discount_cents").notNull().default(0),
    sourcePayloadHash: text("source_payload_hash").notNull(),
    syncRunId: text("sync_run_id").notNull().references(() => integrationSyncRuns.id, { onDelete: "cascade" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("commerce_sale_lines_external_unique").on(table.organizationId, table.provider, table.connectionId, table.externalSaleId, table.externalLineId),
    index("commerce_sale_lines_product_date_idx").on(table.organizationId, table.provider, table.productRef, table.soldAt),
    index("commerce_sale_lines_customer_date_idx").on(table.organizationId, table.provider, table.customerRef, table.soldAt),
  ],
);

// Tender facts are deliberately stored without card, bank-account, gateway or
// customer details.  They support sales reconciliation and payment-mix
// reporting while keeping the analytics surface outside PCI scope.
export const commercePayments = sqliteTable(
  "commerce_payments",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    connectionId: text("connection_id").notNull().default("legacy"),
    externalPaymentId: text("external_payment_id").notNull(),
    externalSaleId: text("external_sale_id").notNull(),
    paymentTypeRef: text("payment_type_ref"),
    paymentTypeName: text("payment_type_name").notNull().default("Other"),
    category: text("category", { enum: ["cash", "card", "gift_card", "store_credit", "other"] }).notNull().default("other"),
    amountCents: integer("amount_cents").notNull(),
    paidAt: text("paid_at"),
    outletRef: text("outlet_ref"),
    sourcePayloadHash: text("source_payload_hash").notNull(),
    syncRunId: text("sync_run_id").notNull().references(() => integrationSyncRuns.id, { onDelete: "cascade" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("commerce_payments_external_unique").on(table.organizationId, table.provider, table.connectionId, table.externalPaymentId),
    index("commerce_payments_sale_idx").on(table.organizationId, table.provider, table.externalSaleId),
    index("commerce_payments_date_idx").on(table.organizationId, table.provider, table.paidAt),
    check("commerce_payments_category_check", sql`${table.category} in ('cash','card','gift_card','store_credit','other')`),
  ],
);

// Stripe financial facts remain in an isolated staging ledger until a
// reconciliation review explicitly promotes them. Customer, card and bank
// account details are intentionally excluded from this table.
export const integrationStagedFinancialRecords = sqliteTable(
  "integration_staged_financial_records",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    connectionId: text("connection_id").notNull().default("legacy"),
    externalRecordId: text("external_record_id").notNull(),
    recordType: text("record_type", { enum: ["balance_transaction", "payout"] }).notNull(),
    category: text("category").notNull(),
    sourceRef: text("source_ref"),
    occurredAt: text("occurred_at").notNull(),
    availableAt: text("available_at"),
    currency: text("currency").notNull(),
    grossCents: integer("gross_cents").notNull(),
    feeCents: integer("fee_cents").notNull().default(0),
    netCents: integer("net_cents").notNull(),
    state: text("state").notNull(),
    livemode: integer("livemode", { mode: "boolean" }).notNull().default(false),
    sourcePayloadHash: text("source_payload_hash").notNull(),
    syncRunId: text("sync_run_id").notNull().references(() => integrationSyncRuns.id, { onDelete: "cascade" }),
    stagedAt: integer("staged_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("integration_staged_financial_record_unique").on(
      table.organizationId,
      table.provider,
      table.connectionId,
      table.externalRecordId,
      table.sourcePayloadHash,
    ),
    index("integration_staged_financial_date_idx").on(
      table.organizationId,
      table.provider,
      table.recordType,
      table.occurredAt,
    ),
    check("integration_staged_financial_type_check", sql`${table.recordType} in ('balance_transaction', 'payout')`),
    check("integration_staged_financial_currency_check", sql`length(${table.currency}) = 3`),
  ],
);

export const integrationWebhookEvents = sqliteTable(
  "integration_webhook_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    connectionId: text("connection_id").notNull().default("legacy"),
    payloadHash: text("payload_hash").notNull(),
    signatureHash: text("signature_hash").notNull(),
    eventType: text("event_type").notNull(),
    externalObjectRef: text("external_object_ref"),
    status: text("status", { enum: ["queued", "processed", "rejected"] }).notNull().default("queued"),
    receivedAt: integer("received_at", { mode: "timestamp" }).notNull(),
    processedAt: integer("processed_at", { mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("integration_webhook_events_replay_unique").on(table.organizationId, table.provider, table.connectionId, table.payloadHash),
    index("integration_webhook_events_status_idx").on(table.organizationId, table.provider, table.connectionId, table.status, table.receivedAt),
    check("integration_webhook_events_status_check", sql`${table.status} in ('queued', 'processed', 'rejected')`),
  ],
);

// Organization governance is deliberately separated from the immutable
// accounting ledger. These records can change without rewriting posted facts.
export const organizationProfiles = sqliteTable(
  "organization_profiles",
  {
    organizationId: text("organization_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    organizationType: text("organization_type").notNull().default("business"),
    businessStructure: text("business_structure").notNull().default(""),
    locale: text("locale").notNull().default("en-CA"),
    language: text("language").notNull().default("en"),
    brandColor: text("brand_color").notNull().default("#2368c4"),
    logoObjectKey: text("logo_object_key"),
    logoContentType: text("logo_content_type"),
    logoAltText: text("logo_alt_text").notNull().default("Organization logo"),
    logoVersion: integer("logo_version").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [check("organization_profiles_logo_version_check", sql`${table.logoVersion} >= 0`)],
);

export const organizationLocations = sqliteTable(
  "organization_locations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
    countryCode: text("country_code").notNull(),
    addressLine1: text("address_line_1").notNull(),
    addressLine2: text("address_line_2").notNull().default(""),
    addressLine3: text("address_line_3").notNull().default(""),
    locality: text("locality").notNull(),
    district: text("district").notNull().default(""),
    administrativeArea: text("administrative_area").notNull(),
    postalCode: text("postal_code").notNull().default(""),
    timezone: text("timezone").notNull(),
    currency: text("currency").notNull(),
    locale: text("locale").notNull().default("en-CA"),
    taxJurisdiction: text("tax_jurisdiction").notNull().default(""),
    validationStatus: text("validation_status", { enum: ["entered", "suggested", "validated"] }).notNull().default("entered"),
    latitudeE6: integer("latitude_e6"),
    longitudeE6: integer("longitude_e6"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("organization_locations_name_unique").on(table.organizationId, table.name),
    index("organization_locations_status_idx").on(table.organizationId, table.status),
    check("organization_locations_status_check", sql`${table.status} in ('active', 'archived')`),
    check("organization_locations_validation_check", sql`${table.validationStatus} in ('entered', 'suggested', 'validated')`),
  ],
);

// Consolidated commerce reports use one reviewed source per logical channel
// and fact family at each organization location. Provider-specific reports may
// still show every approved connection independently, but overlapping sources
// never enter consolidated totals without this explicit authority record.
export const integrationSourceAuthorities = sqliteTable(
  "integration_source_authorities",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    localLocationId: text("local_location_id").notNull().references(() => organizationLocations.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: ["retail", "ecommerce", "marketplace", "delivery"] }).notNull(),
    factFamily: text("fact_family", { enum: ["sales", "payments", "inventory", "products", "customers", "suppliers"] }).notNull(),
    provider: text("provider").notNull(),
    connectionId: text("connection_id").notNull().references(() => integrationConnections.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
    updatedByUserId: text("updated_by_user_id").notNull().references(() => users.id),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("integration_source_authorities_scope_unique").on(table.organizationId, table.localLocationId, table.channel, table.factFamily),
    index("integration_source_authorities_connection_idx").on(table.organizationId, table.connectionId),
    check("integration_source_authorities_channel_check", sql`${table.channel} in ('retail','ecommerce','marketplace','delivery')`),
    check("integration_source_authorities_family_check", sql`${table.factFamily} in ('sales','payments','inventory','products','customers','suppliers')`),
    check("integration_source_authorities_version_check", sql`${table.version} >= 1`),
  ],
);

export const accessRoles = sqliteTable(
  "access_roles",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    color: text("color").notNull().default("#53657a"),
    systemKey: text("system_key"),
    permissionsJson: text("permissions_json").notNull().default("[]"),
    locationScopeJson: text("location_scope_json").notNull().default("[]"),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("access_roles_name_unique").on(table.organizationId, table.name),
    uniqueIndex("access_roles_system_unique").on(table.organizationId, table.systemKey),
    index("access_roles_workspace_idx").on(table.organizationId, table.archived),
  ],
);

export const teamMembers = sqliteTable(
  "team_members",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    roleId: text("role_id").references(() => accessRoles.id, { onDelete: "set null" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    preferredName: text("preferred_name").notNull().default(""),
    email: text("email").notNull(),
    mobile: text("mobile").notNull().default(""),
    employeeCode: text("employee_code").notNull(),
    jobTitle: text("job_title").notNull().default(""),
    department: text("department").notNull().default(""),
    employmentType: text("employment_type").notNull().default("employee"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    managerMemberId: text("manager_member_id"),
    primaryLocationId: text("primary_location_id").references(() => organizationLocations.id, { onDelete: "set null" }),
    permittedLocationsJson: text("permitted_locations_json").notNull().default("[]"),
    status: text("status", { enum: ["draft", "invited", "invitation_expired", "pending_verification", "active", "suspended", "archived"] }).notNull().default("draft"),
    remoteLogin: integer("remote_login", { mode: "boolean" }).notNull().default(false),
    requireMfa: integer("require_mfa", { mode: "boolean" }).notNull().default(false),
    pinEnabled: integer("pin_enabled", { mode: "boolean" }).notNull().default(false),
    invitationSentAt: integer("invitation_sent_at", { mode: "timestamp" }),
    invitationExpiresAt: integer("invitation_expires_at", { mode: "timestamp" }),
    lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
    notes: text("notes").notNull().default(""),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("team_members_email_unique").on(table.organizationId, table.email),
    uniqueIndex("team_members_code_unique").on(table.organizationId, table.employeeCode),
    index("team_members_status_idx").on(table.organizationId, table.status),
    check("team_members_status_check", sql`${table.status} in ('draft', 'invited', 'invitation_expired', 'pending_verification', 'active', 'suspended', 'archived')`),
  ],
);

export const employeePinCredentials = sqliteTable(
  "employee_pin_credentials",
  {
    memberId: text("member_id").primaryKey().references(() => teamMembers.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    saltHex: text("salt_hex").notNull(),
    hashHex: text("hash_hex").notNull(),
    iterations: integer("iterations").notNull().default(210000),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: integer("locked_until", { mode: "timestamp" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    forceChange: integer("force_change", { mode: "boolean" }).notNull().default(true),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("employee_pin_workspace_idx").on(table.organizationId),
    check("employee_pin_iterations_check", sql`${table.iterations} >= 100000`),
    check("employee_pin_failures_check", sql`${table.failedAttempts} >= 0`),
  ],
);

export const workspaceDocuments = sqliteTable(
  "workspace_documents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    documentType: text("document_type", { enum: ["invoice", "receipt", "supplier_statement", "packing_slip", "purchase_order", "other"] }).notNull(),
    fileName: text("file_name").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256Hex: text("sha256_hex").notNull(),
    securityState: text("security_state", { enum: ["quarantined", "clean", "rejected"] }).notNull().default("quarantined"),
    status: text("status", { enum: ["uploaded", "review_required", "approved", "rejected"] }).notNull().default("uploaded"),
    scanStatus: text("scan_status", { enum: ["pending", "clean", "blocked", "failed"] }).notNull().default("pending"),
    scannedAt: integer("scanned_at", { mode: "timestamp" }),
    scanProvider: text("scan_provider"),
    extractionStatus: text("extraction_status", { enum: ["not_configured", "pending", "complete", "failed"] }).notNull().default("not_configured"),
    extractedJson: text("extracted_json").notNull().default("{}"),
    uploadedByUserId: text("uploaded_by_user_id").notNull().references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("workspace_documents_hash_unique").on(table.organizationId, table.sha256Hex),
    check("workspace_documents_security_state_check", sql`${table.securityState} in ('quarantined', 'clean', 'rejected')`),
    index("workspace_documents_status_idx").on(table.organizationId, table.status),
    index("workspace_documents_scan_idx").on(table.organizationId, table.scanStatus),
    check("workspace_documents_size_check", sql`${table.sizeBytes} > 0 and ${table.sizeBytes} <= 10485760`),
    check("workspace_documents_scan_status_check", sql`${table.scanStatus} in ('pending', 'clean', 'blocked', 'failed')`),
  ],
);

export const purchaseOrders = sqliteTable(
  "purchase_orders",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    orderNumber: text("order_number").notNull(),
    supplierName: text("supplier_name").notNull(),
    deliveryLocationId: text("delivery_location_id").references(() => organizationLocations.id, { onDelete: "set null" }),
    orderDate: text("order_date").notNull(),
    expectedDeliveryDate: text("expected_delivery_date"),
    currency: text("currency").notNull(),
    paymentTerms: text("payment_terms").notNull().default(""),
    status: text("status", { enum: ["draft", "suggested", "awaiting_approval", "approved", "sent", "acknowledged", "partially_received", "received", "partially_invoiced", "invoiced", "disputed", "closed", "cancelled"] }).notNull().default("draft"),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    discountCents: integer("discount_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    committedCashDate: text("committed_cash_date"),
    notes: text("notes").notNull().default(""),
    approvedByUserId: text("approved_by_user_id").references(() => users.id),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("purchase_orders_number_unique").on(table.organizationId, table.orderNumber),
    index("purchase_orders_status_idx").on(table.organizationId, table.status),
    check("purchase_orders_money_check", sql`${table.subtotalCents} >= 0 and ${table.taxCents} >= 0 and ${table.discountCents} >= 0 and ${table.totalCents} = ${table.subtotalCents} + ${table.taxCents} - ${table.discountCents}`),
  ],
);

export const purchaseOrderLines = sqliteTable(
  "purchase_order_lines",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    purchaseOrderId: text("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),
    provider: text("provider"),
    connectionId: text("connection_id").references(() => integrationConnections.id, { onDelete: "set null" }),
    externalProductRef: text("external_product_ref"),
    sku: text("sku").notNull().default(""),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    receivedQuantity: integer("received_quantity").notNull().default(0),
    invoicedQuantity: integer("invoiced_quantity").notNull().default(0),
    unitCostCents: integer("unit_cost_cents").notNull(),
    previousCostCents: integer("previous_cost_cents"),
    landedCostCents: integer("landed_cost_cents"),
    currentInventory: integer("current_inventory"),
    reorderPoint: integer("reorder_point"),
    forecastDemand: integer("forecast_demand"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("purchase_order_lines_number_unique").on(table.purchaseOrderId, table.lineNumber),
    index("purchase_order_lines_workspace_idx").on(table.organizationId, table.purchaseOrderId),
    index("purchase_order_lines_product_idx").on(table.organizationId, table.provider, table.connectionId, table.externalProductRef),
    check("purchase_order_lines_quantity_check", sql`${table.quantity} > 0 and ${table.receivedQuantity} >= 0 and ${table.invoicedQuantity} >= 0`),
    check("purchase_order_lines_cost_check", sql`${table.unitCostCents} >= 0`),
  ],
);

export const goodsReceipts = sqliteTable(
  "goods_receipts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    purchaseOrderId: text("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
    receivedDate: text("received_date").notNull(),
    receivedByUserId: text("received_by_user_id").notNull().references(() => users.id),
    linesJson: text("lines_json").notNull(),
    discrepancyStatus: text("discrepancy_status", { enum: ["matched", "short", "over", "damaged", "review_required"] }).notNull().default("matched"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("goods_receipts_po_idx").on(table.organizationId, table.purchaseOrderId)],
);

export const invoiceMatches = sqliteTable(
  "invoice_matches",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    purchaseOrderId: text("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
    documentId: text("document_id").notNull().references(() => workspaceDocuments.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["matched", "quantity_mismatch", "price_mismatch", "tax_mismatch", "review_required"] }).notNull(),
    differenceCents: integer("difference_cents").notNull().default(0),
    detailsJson: text("details_json").notNull().default("{}"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("invoice_matches_document_unique").on(table.organizationId, table.documentId),
    index("invoice_matches_po_idx").on(table.organizationId, table.purchaseOrderId),
  ],
);

// BookLoQ stores every monetary amount as an integer number of minor currency
// units (for example, Canadian cents). Rates use integer basis points or parts
// per million. JavaScript floating-point values are never persisted as money.
export const bookloqSettings = sqliteTable(
  "bookloq_settings",
  {
    organizationId: text("organization_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
    baseCurrency: text("base_currency").notNull().default("CAD"),
    countryCode: text("country_code").notNull().default("CA"),
    provinceCode: text("province_code").notNull().default("AB"),
    accountingBasis: text("accounting_basis", { enum: ["accrual", "cash"] }).notNull().default("accrual"),
    fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1),
    cashSafetyThresholdCents: integer("cash_safety_threshold_cents").notNull().default(0),
    status: text("status", { enum: ["not_configured", "active", "suspended"] }).notNull().default("not_configured"),
    dataMode: text("data_mode", { enum: ["live", "demonstration"] }).notNull().default("live"),
    updatedByUserId: text("updated_by_user_id").notNull().references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    check("bookloq_settings_basis_check", sql`${table.accountingBasis} in ('accrual', 'cash')`),
    check("bookloq_settings_status_check", sql`${table.status} in ('not_configured', 'active', 'suspended')`),
    check("bookloq_settings_mode_check", sql`${table.dataMode} in ('live', 'demonstration')`),
    check("bookloq_settings_fiscal_month_check", sql`${table.fiscalYearStartMonth} between 1 and 12`),
    check("bookloq_settings_threshold_check", sql`${table.cashSafetyThresholdCents} >= 0`),
  ],
);

export const bookloqRoleAssignments = sqliteTable(
  "bookloq_role_assignments",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "administrator", "finance_manager", "store_manager", "accountant", "bookkeeper", "ap_clerk", "ar_clerk", "employee", "read_only_auditor"] }).notNull(),
    permissionsJson: text("permissions_json").notNull().default("[]"),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("bookloq_roles_workspace_user_unique").on(table.organizationId, table.userId),
    index("bookloq_roles_workspace_role_idx").on(table.organizationId, table.role),
    check("bookloq_roles_role_check", sql`${table.role} in ('owner', 'administrator', 'finance_manager', 'store_manager', 'accountant', 'bookkeeper', 'ap_clerk', 'ar_clerk', 'employee', 'read_only_auditor')`),
  ],
);

export const financialAccounts = sqliteTable(
  "financial_accounts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    accountType: text("account_type", { enum: ["asset", "liability", "equity", "revenue", "expense"] }).notNull(),
    accountSubtype: text("account_subtype").notNull(),
    normalBalance: text("normal_balance", { enum: ["debit", "credit"] }).notNull(),
    systemKey: text("system_key"),
    parentAccountId: text("parent_account_id"),
    description: text("description").notNull().default(""),
    plainLanguage: text("plain_language").notNull().default(""),
    taxTreatment: text("tax_treatment").notNull().default("none"),
    restricted: integer("restricted", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("financial_accounts_workspace_code_unique").on(table.organizationId, table.code),
    uniqueIndex("financial_accounts_workspace_system_unique").on(table.organizationId, table.systemKey),
    index("financial_accounts_workspace_type_idx").on(table.organizationId, table.accountType),
    check("financial_accounts_type_check", sql`${table.accountType} in ('asset', 'liability', 'equity', 'revenue', 'expense')`),
    check("financial_accounts_normal_balance_check", sql`${table.normalBalance} in ('debit', 'credit')`),
  ],
);

export const accountingPeriods = sqliteTable(
  "accounting_periods",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    status: text("status", { enum: ["open", "review", "locked"] }).notNull().default("open"),
    lockedAt: integer("locked_at", { mode: "timestamp" }),
    lockedByUserId: text("locked_by_user_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("accounting_periods_workspace_dates_unique").on(table.organizationId, table.startDate, table.endDate),
    index("accounting_periods_workspace_status_idx").on(table.organizationId, table.status),
    check("accounting_periods_status_check", sql`${table.status} in ('open', 'review', 'locked')`),
    check("accounting_periods_dates_check", sql`${table.startDate} <= ${table.endDate}`),
  ],
);

export const bookloqContacts = sqliteTable(
  "bookloq_contacts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    contactType: text("contact_type", { enum: ["customer", "supplier", "both"] }).notNull(),
    name: text("name").notNull(),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    billingAddress: text("billing_address").notNull().default(""),
    paymentTermsDays: integer("payment_terms_days").notNull().default(30),
    creditLimitCents: integer("credit_limit_cents").notNull().default(0),
    taxRegistrationNumber: text("tax_registration_number").notNull().default(""),
    notes: text("notes").notNull().default(""),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("bookloq_contacts_workspace_type_idx").on(table.organizationId, table.contactType),
    check("bookloq_contacts_type_check", sql`${table.contactType} in ('customer', 'supplier', 'both')`),
    check("bookloq_contacts_terms_check", sql`${table.paymentTermsDays} between 0 and 365`),
    check("bookloq_contacts_credit_check", sql`${table.creditLimitCents} >= 0`),
  ],
);

export const journalEntries = sqliteTable(
  "journal_entries",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    entryNumber: text("entry_number").notNull(),
    entryDate: text("entry_date").notNull(),
    postingDate: text("posting_date").notNull(),
    periodId: text("period_id").references(() => accountingPeriods.id),
    status: text("status", { enum: ["draft", "posted", "reversed", "void"] }).notNull().default("draft"),
    sourceType: text("source_type").notNull().default("manual"),
    sourceRef: text("source_ref"),
    memo: text("memo").notNull(),
    currency: text("currency").notNull().default("CAD"),
    exchangeRatePpm: integer("exchange_rate_ppm").notNull().default(1_000_000),
    totalDebitCents: integer("total_debit_cents").notNull(),
    totalCreditCents: integer("total_credit_cents").notNull(),
    reversalOfEntryId: text("reversal_of_entry_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    preparedByUserId: text("prepared_by_user_id").notNull().references(() => users.id),
    approvedByUserId: text("approved_by_user_id").references(() => users.id),
    postedAt: integer("posted_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("journal_entries_workspace_number_unique").on(table.organizationId, table.entryNumber),
    uniqueIndex("journal_entries_workspace_idempotency_unique").on(table.organizationId, table.idempotencyKey),
    uniqueIndex("journal_entries_workspace_reversal_unique").on(table.organizationId, table.reversalOfEntryId),
    index("journal_entries_workspace_date_idx").on(table.organizationId, table.postingDate),
    index("journal_entries_workspace_status_idx").on(table.organizationId, table.status),
    check("journal_entries_status_check", sql`${table.status} in ('draft', 'posted', 'reversed', 'void')`),
    check("journal_entries_money_check", sql`${table.totalDebitCents} >= 0 and ${table.totalCreditCents} >= 0`),
    check("journal_entries_balance_check", sql`${table.status} != 'posted' or ${table.totalDebitCents} = ${table.totalCreditCents}`),
    check("journal_entries_rate_check", sql`${table.exchangeRatePpm} > 0`),
  ],
);

export const journalLines = sqliteTable(
  "journal_lines",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    journalEntryId: text("journal_entry_id").notNull().references(() => journalEntries.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),
    accountId: text("account_id").notNull().references(() => financialAccounts.id),
    description: text("description").notNull().default(""),
    debitCents: integer("debit_cents").notNull().default(0),
    creditCents: integer("credit_cents").notNull().default(0),
    taxCode: text("tax_code"),
    taxAmountCents: integer("tax_amount_cents").notNull().default(0),
    contactId: text("contact_id").references(() => bookloqContacts.id),
    locationRef: text("location_ref").notNull().default("all"),
    departmentRef: text("department_ref"),
    projectRef: text("project_ref"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("journal_lines_entry_line_unique").on(table.journalEntryId, table.lineNumber),
    index("journal_lines_workspace_account_idx").on(table.organizationId, table.accountId),
    check("journal_lines_amount_check", sql`${table.debitCents} >= 0 and ${table.creditCents} >= 0 and ((${table.debitCents} > 0 and ${table.creditCents} = 0) or (${table.creditCents} > 0 and ${table.debitCents} = 0))`),
    check("journal_lines_tax_check", sql`${table.taxAmountCents} >= 0`),
  ],
);

export const financialTransactions = sqliteTable(
  "financial_transactions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    transactionDate: text("transaction_date").notNull(),
    postingDate: text("posting_date").notNull(),
    description: text("description").notNull(),
    originalDescription: text("original_description").notNull().default(""),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("CAD"),
    exchangeRatePpm: integer("exchange_rate_ppm").notNull().default(1_000_000),
    taxAmountCents: integer("tax_amount_cents").notNull().default(0),
    accountId: text("account_id").references(() => financialAccounts.id),
    contactId: text("contact_id").references(() => bookloqContacts.id),
    sourceSystem: text("source_system").notNull(),
    externalSourceId: text("external_source_id").notNull(),
    sourceState: text("source_state", { enum: ["pending", "posted", "modified", "removed"] }).notNull().default("posted"),
    pendingExternalSourceId: text("pending_external_source_id"),
    locationRef: text("location_ref").notNull().default("all"),
    departmentRef: text("department_ref"),
    projectRef: text("project_ref"),
    reconciliationStatus: text("reconciliation_status", { enum: ["unreconciled", "matched", "reconciled"] }).notNull().default("unreconciled"),
    categorizationStatus: text("categorization_status", { enum: ["confirmed", "suggested", "missing", "issue", "accountant_review"] }).notNull().default("missing"),
    confidenceBasisPoints: integer("confidence_basis_points").notNull().default(0),
    approvalStatus: text("approval_status", { enum: ["not_required", "pending", "approved", "rejected"] }).notNull().default("not_required"),
    journalEntryId: text("journal_entry_id").references(() => journalEntries.id),
    demoRecord: integer("demo_record", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("financial_transactions_source_unique").on(table.organizationId, table.sourceSystem, table.externalSourceId),
    index("financial_transactions_workspace_date_idx").on(table.organizationId, table.postingDate),
    index("financial_transactions_workspace_review_idx").on(table.organizationId, table.categorizationStatus, table.reconciliationStatus),
    check("financial_transactions_reconciliation_check", sql`${table.reconciliationStatus} in ('unreconciled', 'matched', 'reconciled')`),
    check("financial_transactions_categorization_check", sql`${table.categorizationStatus} in ('confirmed', 'suggested', 'missing', 'issue', 'accountant_review')`),
    check("financial_transactions_confidence_check", sql`${table.confidenceBasisPoints} between 0 and 10000`),
    check("financial_transactions_source_state_check", sql`${table.sourceState} in ('pending', 'posted', 'modified', 'removed')`),
  ],
);

export const bankAccounts = sqliteTable(
  "bank_accounts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    financialAccountId: text("financial_account_id").notNull().references(() => financialAccounts.id),
    name: text("name").notNull(),
    accountType: text("account_type", { enum: ["chequing", "savings", "credit_card", "line_of_credit", "merchant", "loan"] }).notNull(),
    institutionName: text("institution_name").notNull(),
    maskedNumber: text("masked_number").notNull(),
    currency: text("currency").notNull().default("CAD"),
    provider: text("provider").notNull().default("manual"),
    externalAccountRef: text("external_account_ref"),
    externalItemRef: text("external_item_ref"),
    liveBalanceCents: integer("live_balance_cents"),
    availableBalanceCents: integer("available_balance_cents"),
    bookBalanceCents: integer("book_balance_cents").notNull().default(0),
    availableCreditCents: integer("available_credit_cents"),
    connectionStatus: text("connection_status", { enum: ["manual", "healthy", "delayed", "error"] }).notNull().default("manual"),
    lastSyncAt: integer("last_sync_at", { mode: "timestamp" }),
    lastReconciledAt: integer("last_reconciled_at", { mode: "timestamp" }),
    demoRecord: integer("demo_record", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("bank_accounts_workspace_ledger_unique").on(table.organizationId, table.financialAccountId),
    uniqueIndex("bank_accounts_provider_external_unique").on(table.organizationId, table.provider, table.externalAccountRef),
    check("bank_accounts_type_check", sql`${table.accountType} in ('chequing', 'savings', 'credit_card', 'line_of_credit', 'merchant', 'loan')`),
    check("bank_accounts_connection_check", sql`${table.connectionStatus} in ('manual', 'healthy', 'delayed', 'error')`),
  ],
);

export const reconciliations = sqliteTable(
  "reconciliations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull().references(() => financialAccounts.id),
    reconciliationType: text("reconciliation_type").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    openingBalanceCents: integer("opening_balance_cents").notNull(),
    closingBalanceCents: integer("closing_balance_cents").notNull(),
    bookBalanceCents: integer("book_balance_cents").notNull(),
    differenceCents: integer("difference_cents").notNull(),
    status: text("status", { enum: ["draft", "prepared", "reviewed", "completed", "locked"] }).notNull().default("draft"),
    preparedByUserId: text("prepared_by_user_id").references(() => users.id),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("reconciliations_workspace_account_period_unique").on(table.organizationId, table.accountId, table.startDate, table.endDate),
    index("reconciliations_workspace_status_idx").on(table.organizationId, table.status),
    check("reconciliations_status_check", sql`${table.status} in ('draft', 'prepared', 'reviewed', 'completed', 'locked')`),
    check("reconciliations_dates_check", sql`${table.startDate} <= ${table.endDate}`),
  ],
);

export const supplierBills = sqliteTable(
  "supplier_bills",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    supplierId: text("supplier_id").notNull().references(() => bookloqContacts.id),
    billNumber: text("bill_number").notNull(),
    invoiceDate: text("invoice_date").notNull(),
    dueDate: text("due_date").notNull(),
    status: text("status", { enum: ["draft", "received", "extracted", "under_review", "matched", "awaiting_approval", "approved", "scheduled", "partially_paid", "paid", "reconciled", "disputed", "void"] }).notNull().default("draft"),
    subtotalCents: integer("subtotal_cents").notNull(),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    paidCents: integer("paid_cents").notNull().default(0),
    currency: text("currency").notNull().default("CAD"),
    purchaseOrderRef: text("purchase_order_ref"),
    locationRef: text("location_ref").notNull().default("all"),
    approvalStatus: text("approval_status", { enum: ["not_required", "pending", "approved", "rejected"] }).notNull().default("pending"),
    journalEntryId: text("journal_entry_id").references(() => journalEntries.id),
    demoRecord: integer("demo_record", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("supplier_bills_workspace_number_unique").on(table.organizationId, table.supplierId, table.billNumber),
    index("supplier_bills_workspace_due_idx").on(table.organizationId, table.dueDate, table.status),
    check("supplier_bills_amount_check", sql`${table.subtotalCents} >= 0 and ${table.taxCents} >= 0 and ${table.totalCents} = ${table.subtotalCents} + ${table.taxCents} and ${table.paidCents} >= 0 and ${table.paidCents} <= ${table.totalCents}`),
  ],
);

export const customerInvoices = sqliteTable(
  "customer_invoices",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    customerId: text("customer_id").notNull().references(() => bookloqContacts.id),
    invoiceNumber: text("invoice_number").notNull(),
    invoiceDate: text("invoice_date").notNull(),
    dueDate: text("due_date").notNull(),
    status: text("status", { enum: ["draft", "approved", "sent", "viewed", "due", "partially_paid", "paid", "overdue", "disputed", "written_off", "void"] }).notNull().default("draft"),
    subtotalCents: integer("subtotal_cents").notNull(),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    paidCents: integer("paid_cents").notNull().default(0),
    currency: text("currency").notNull().default("CAD"),
    locationRef: text("location_ref").notNull().default("all"),
    purchaseOrderRef: text("purchase_order_ref").notNull().default(""),
    issuerSnapshotJson: text("issuer_snapshot_json").notNull().default("{}"),
    customerSnapshotJson: text("customer_snapshot_json").notNull().default("{}"),
    notes: text("notes").notNull().default(""),
    paymentInstructions: text("payment_instructions").notNull().default(""),
    documentId: text("document_id").references(() => workspaceDocuments.id, { onDelete: "set null" }),
    sentAt: integer("sent_at", { mode: "timestamp" }),
    emailedTo: text("emailed_to"),
    journalEntryId: text("journal_entry_id").references(() => journalEntries.id),
    demoRecord: integer("demo_record", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("customer_invoices_workspace_number_unique").on(table.organizationId, table.invoiceNumber),
    index("customer_invoices_workspace_due_idx").on(table.organizationId, table.dueDate, table.status),
    uniqueIndex("customer_invoices_document_unique").on(table.organizationId, table.documentId),
    check("customer_invoices_amount_check", sql`${table.subtotalCents} >= 0 and ${table.taxCents} >= 0 and ${table.totalCents} = ${table.subtotalCents} + ${table.taxCents} and ${table.paidCents} >= 0 and ${table.paidCents} <= ${table.totalCents}`),
  ],
);

export const customerInvoiceLines = sqliteTable(
  "customer_invoice_lines",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id").notNull().references(() => customerInvoices.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),
    description: text("description").notNull(),
    quantityMilli: integer("quantity_milli").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    taxRateBasisPoints: integer("tax_rate_basis_points").notNull().default(0),
    subtotalCents: integer("subtotal_cents").notNull(),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("customer_invoice_lines_invoice_line_unique").on(table.organizationId, table.invoiceId, table.lineNumber),
    index("customer_invoice_lines_invoice_idx").on(table.organizationId, table.invoiceId),
    check("customer_invoice_lines_quantity_check", sql`${table.quantityMilli} > 0 and ${table.quantityMilli} <= 1000000000`),
    check("customer_invoice_lines_amount_check", sql`${table.unitPriceCents} >= 0 and ${table.subtotalCents} >= 0 and ${table.taxCents} >= 0 and ${table.totalCents} = ${table.subtotalCents} + ${table.taxCents}`),
    check("customer_invoice_lines_tax_check", sql`${table.taxRateBasisPoints} between 0 and 10000`),
  ],
);

export const bookloqAlerts = sqliteTable(
  "bookloq_alerts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    severity: text("severity", { enum: ["critical", "attention", "opportunity", "informational"] }).notNull(),
    alertType: text("alert_type").notNull(),
    title: text("title").notNull(),
    explanation: text("explanation").notNull(),
    dollarImpactCents: integer("dollar_impact_cents"),
    confidence: text("confidence", { enum: ["high", "medium", "low"] }).notNull(),
    supportingRecordsJson: text("supporting_records_json").notNull().default("[]"),
    recommendedAction: text("recommended_action").notNull(),
    assignedUserId: text("assigned_user_id").references(() => users.id),
    dueDate: text("due_date"),
    status: text("status", { enum: ["open", "in_progress", "resolved", "dismissed"] }).notNull().default("open"),
    resolutionHistoryJson: text("resolution_history_json").notNull().default("[]"),
    demoRecord: integer("demo_record", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("bookloq_alerts_workspace_status_idx").on(table.organizationId, table.status, table.severity),
    check("bookloq_alerts_severity_check", sql`${table.severity} in ('critical', 'attention', 'opportunity', 'informational')`),
    check("bookloq_alerts_confidence_check", sql`${table.confidence} in ('high', 'medium', 'low')`),
    check("bookloq_alerts_status_check", sql`${table.status} in ('open', 'in_progress', 'resolved', 'dismissed')`),
  ],
);

export const bookloqBudgets = sqliteTable(
  "bookloq_budgets",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull().references(() => financialAccounts.id),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    locationRef: text("location_ref").notNull().default("all"),
    departmentRef: text("department_ref").notNull().default("all"),
    budgetCents: integer("budget_cents").notNull(),
    committedCents: integer("committed_cents").notNull().default(0),
    forecastCents: integer("forecast_cents").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("bookloq_budgets_scope_unique").on(table.organizationId, table.accountId, table.periodStart, table.periodEnd, table.locationRef, table.departmentRef),
    check("bookloq_budgets_amount_check", sql`${table.budgetCents} >= 0 and ${table.committedCents} >= 0 and ${table.forecastCents} >= 0`),
  ],
);

export const monthEndItems = sqliteTable(
  "month_end_items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    periodId: text("period_id").notNull().references(() => accountingPeriods.id, { onDelete: "cascade" }),
    itemKey: text("item_key").notNull(),
    title: text("title").notNull(),
    status: text("status", { enum: ["not_started", "in_progress", "blocked", "complete"] }).notNull().default("not_started"),
    assignedUserId: text("assigned_user_id").references(() => users.id),
    dueDate: text("due_date"),
    blocker: text("blocker").notNull().default(""),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("month_end_items_period_key_unique").on(table.periodId, table.itemKey),
    index("month_end_items_workspace_status_idx").on(table.organizationId, table.status),
    check("month_end_items_status_check", sql`${table.status} in ('not_started', 'in_progress', 'blocked', 'complete')`),
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
