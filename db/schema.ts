import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }), organizationId: text("organization_id").notNull(), title: text("title").notNull(), detail: text("detail").notNull().default(""), priority: text("priority", { enum: ["high", "medium", "low"] }).notNull().default("medium"), status: text("status", { enum: ["open", "in_progress", "done"] }).notNull().default("open"), assignee: text("assignee").notNull().default("Hussien"), dueDate: text("due_date"), createdBy: text("created_by").notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
