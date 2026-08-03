CREATE TABLE `business_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_type` text NOT NULL,
	`title` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`event_date` text NOT NULL,
	`expected_outcome` text DEFAULT '' NOT NULL,
	`review_date` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "business_events_type_check" CHECK("business_events"."event_type" in ('decision', 'promotion', 'hours', 'staffing', 'supplier_price', 'stockout', 'competitor', 'construction', 'other')),
	CONSTRAINT "business_events_status_check" CHECK("business_events"."status" in ('active', 'reviewed'))
);
--> statement-breakpoint
CREATE INDEX `business_events_workspace_date_idx` ON `business_events` (`organization_id`,`event_date`);--> statement-breakpoint
CREATE TABLE `daily_business_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` text NOT NULL,
	`business_date` text NOT NULL,
	`location_ref` text DEFAULT 'all' NOT NULL,
	`gross_sales_cents` integer NOT NULL,
	`net_sales_cents` integer NOT NULL,
	`cost_of_goods_cents` integer NOT NULL,
	`transaction_count` integer NOT NULL,
	`units_sold` integer NOT NULL,
	`refunds_cents` integer DEFAULT 0 NOT NULL,
	`discounts_cents` integer DEFAULT 0 NOT NULL,
	`labour_cost_cents` integer DEFAULT 0 NOT NULL,
	`inventory_value_cents` integer,
	`cash_balance_cents` integer,
	`accounts_payable_cents` integer,
	`source_import_id` text,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_import_id`) REFERENCES `data_imports`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "daily_metrics_nonnegative_amounts_check" CHECK("daily_business_metrics"."gross_sales_cents" >= 0 and "daily_business_metrics"."net_sales_cents" >= 0 and "daily_business_metrics"."cost_of_goods_cents" >= 0 and "daily_business_metrics"."refunds_cents" >= 0 and "daily_business_metrics"."discounts_cents" >= 0 and "daily_business_metrics"."labour_cost_cents" >= 0),
	CONSTRAINT "daily_metrics_nonnegative_counts_check" CHECK("daily_business_metrics"."transaction_count" >= 0 and "daily_business_metrics"."units_sold" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_metrics_workspace_date_location_unique` ON `daily_business_metrics` (`organization_id`,`business_date`,`location_ref`);--> statement-breakpoint
CREATE INDEX `daily_metrics_workspace_date_idx` ON `daily_business_metrics` (`organization_id`,`business_date`);--> statement-breakpoint
CREATE TABLE `data_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`import_type` text NOT NULL,
	`status` text NOT NULL,
	`file_name` text DEFAULT '' NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`idempotency_key` text NOT NULL,
	`imported_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`imported_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "data_imports_type_check" CHECK("data_imports"."import_type" in ('daily_summary_csv', 'manual_entry')),
	CONSTRAINT "data_imports_status_check" CHECK("data_imports"."status" in ('processing', 'completed', 'failed')),
	CONSTRAINT "data_imports_row_count_check" CHECK("data_imports"."row_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_imports_workspace_idempotency_unique` ON `data_imports` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `data_imports_workspace_created_idx` ON `data_imports` (`organization_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workspace_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` text NOT NULL,
	`title` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`assignee` text DEFAULT 'Owner' NOT NULL,
	`due_date` text,
	`source_type` text DEFAULT 'manual' NOT NULL,
	`source_ref` text,
	`expected_impact` text DEFAULT '' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workspace_tasks_priority_check" CHECK("__new_workspace_tasks"."priority" in ('high', 'medium', 'low')),
	CONSTRAINT "workspace_tasks_status_check" CHECK("__new_workspace_tasks"."status" in ('open', 'in_progress', 'done')),
	CONSTRAINT "workspace_tasks_source_type_check" CHECK("__new_workspace_tasks"."source_type" in ('manual', 'insight', 'alert', 'decision'))
);
--> statement-breakpoint
INSERT INTO `__new_workspace_tasks`("id", "organization_id", "title", "detail", "priority", "status", "assignee", "due_date", "source_type", "source_ref", "expected_impact", "created_by_user_id", "idempotency_key", "created_at", "updated_at") SELECT "id", "organization_id", "title", "detail", "priority", "status", "assignee", "due_date", 'manual', NULL, '', "created_by_user_id", "idempotency_key", "created_at", "updated_at" FROM `workspace_tasks`;--> statement-breakpoint
DROP TABLE `workspace_tasks`;--> statement-breakpoint
ALTER TABLE `__new_workspace_tasks` RENAME TO `workspace_tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_tasks_idempotency_unique` ON `workspace_tasks` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `workspace_tasks_workspace_status_idx` ON `workspace_tasks` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `workspace_tasks_workspace_created_idx` ON `workspace_tasks` (`organization_id`,`created_at`);
