PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_daily_business_metrics` (
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
	`source_provider` text,
	`source_connection_id` text,
	`source_import_id` text,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_import_id`) REFERENCES `data_imports`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "daily_metrics_nonnegative_amounts_check" CHECK("__new_daily_business_metrics"."gross_sales_cents" >= 0 and "__new_daily_business_metrics"."refunds_cents" >= 0 and "__new_daily_business_metrics"."discounts_cents" >= 0 and "__new_daily_business_metrics"."labour_cost_cents" >= 0),
	CONSTRAINT "daily_metrics_nonnegative_counts_check" CHECK("__new_daily_business_metrics"."transaction_count" >= 0 and "__new_daily_business_metrics"."units_sold" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_daily_business_metrics`("id", "organization_id", "business_date", "location_ref", "gross_sales_cents", "net_sales_cents", "cost_of_goods_cents", "transaction_count", "units_sold", "refunds_cents", "discounts_cents", "labour_cost_cents", "inventory_value_cents", "cash_balance_cents", "accounts_payable_cents", "source_provider", "source_connection_id", "source_import_id", "created_by_user_id", "created_at", "updated_at") SELECT "id", "organization_id", "business_date", "location_ref", "gross_sales_cents", "net_sales_cents", "cost_of_goods_cents", "transaction_count", "units_sold", "refunds_cents", "discounts_cents", "labour_cost_cents", "inventory_value_cents", "cash_balance_cents", "accounts_payable_cents", "source_provider", "source_connection_id", "source_import_id", "created_by_user_id", "created_at", "updated_at" FROM `daily_business_metrics`;--> statement-breakpoint
DROP TABLE `daily_business_metrics`;--> statement-breakpoint
ALTER TABLE `__new_daily_business_metrics` RENAME TO `daily_business_metrics`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `daily_metrics_workspace_date_location_unique` ON `daily_business_metrics` (`organization_id`,`business_date`,`location_ref`);--> statement-breakpoint
CREATE INDEX `daily_metrics_workspace_date_idx` ON `daily_business_metrics` (`organization_id`,`business_date`);--> statement-breakpoint
CREATE INDEX `daily_metrics_workspace_source_idx` ON `daily_business_metrics` (`organization_id`,`source_connection_id`);