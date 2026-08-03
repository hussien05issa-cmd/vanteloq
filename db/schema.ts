import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }), organizationId: text("organization_id").notNull(), title: text("title").notNull(), detail: text("detail").notNull().default(""), priority: text("priority", { enum: ["high", "medium", "low"] }).notNull().default("medium"), status: text("status", { enum: ["open", "in_progress", "done"] }).notNull().default("open"), assignee: text("assignee").notNull().default("Owner"), dueDate: text("due_date"), createdBy: text("created_by").notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const organizations = sqliteTable("organizations", {
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
  province: text("province").notNull().default("Alberta"),
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
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
