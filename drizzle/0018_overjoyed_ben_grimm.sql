CREATE TABLE `commerce_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_customer_id` text NOT NULL,
	`display_name` text NOT NULL,
	`first_name` text,
	`last_name` text,
	`email` text,
	`phone` text,
	`archived` integer DEFAULT false NOT NULL,
	`source_updated_at` text,
	`source_payload_hash` text NOT NULL,
	`sync_run_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sync_run_id`) REFERENCES `integration_sync_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_customers_external_unique` ON `commerce_customers` (`organization_id`,`provider`,`external_customer_id`);--> statement-breakpoint
CREATE INDEX `commerce_customers_name_idx` ON `commerce_customers` (`organization_id`,`display_name`);--> statement-breakpoint
CREATE TABLE `commerce_products` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_product_id` text NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`category_ref` text,
	`supplier_ref` text,
	`default_cost_cents` integer,
	`default_price_cents` integer,
	`archived` integer DEFAULT false NOT NULL,
	`source_updated_at` text,
	`source_payload_hash` text NOT NULL,
	`sync_run_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sync_run_id`) REFERENCES `integration_sync_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_products_external_unique` ON `commerce_products` (`organization_id`,`provider`,`external_product_id`);--> statement-breakpoint
CREATE INDEX `commerce_products_sku_idx` ON `commerce_products` (`organization_id`,`sku`);--> statement-breakpoint
CREATE INDEX `commerce_products_supplier_idx` ON `commerce_products` (`organization_id`,`provider`,`supplier_ref`);--> statement-breakpoint
CREATE TABLE `commerce_sale_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_sale_id` text NOT NULL,
	`external_line_id` text NOT NULL,
	`product_ref` text,
	`customer_ref` text,
	`outlet_ref` text,
	`sold_at` text,
	`sku` text,
	`product_name` text,
	`quantity_milli` integer DEFAULT 0 NOT NULL,
	`net_sales_cents` integer DEFAULT 0 NOT NULL,
	`cost_cents` integer DEFAULT 0 NOT NULL,
	`discount_cents` integer DEFAULT 0 NOT NULL,
	`source_payload_hash` text NOT NULL,
	`sync_run_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sync_run_id`) REFERENCES `integration_sync_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_sale_lines_external_unique` ON `commerce_sale_lines` (`organization_id`,`provider`,`external_sale_id`,`external_line_id`);--> statement-breakpoint
CREATE INDEX `commerce_sale_lines_product_date_idx` ON `commerce_sale_lines` (`organization_id`,`provider`,`product_ref`,`sold_at`);--> statement-breakpoint
CREATE INDEX `commerce_sale_lines_customer_date_idx` ON `commerce_sale_lines` (`organization_id`,`provider`,`customer_ref`,`sold_at`);--> statement-breakpoint
CREATE TABLE `commerce_suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_supplier_id` text NOT NULL,
	`name` text NOT NULL,
	`account_number` text,
	`contact_name` text,
	`email` text,
	`phone` text,
	`archived` integer DEFAULT false NOT NULL,
	`source_updated_at` text,
	`source_payload_hash` text NOT NULL,
	`sync_run_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sync_run_id`) REFERENCES `integration_sync_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_suppliers_external_unique` ON `commerce_suppliers` (`organization_id`,`provider`,`external_supplier_id`);--> statement-breakpoint
CREATE INDEX `commerce_suppliers_name_idx` ON `commerce_suppliers` (`organization_id`,`name`);--> statement-breakpoint
ALTER TABLE `integration_connections` ADD `external_account_name` text;