PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_commerce_products` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`connection_id` text DEFAULT 'legacy' NOT NULL,
	`external_product_id` text NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`category_ref` text,
	`supplier_ref` text,
	`default_cost_cents` integer,
	`owner_cost_cents` integer,
	`owner_cost_source` text,
	`owner_cost_updated_by_user_id` text,
	`owner_cost_updated_at` integer,
	`default_price_cents` integer,
	`archived` integer DEFAULT false NOT NULL,
	`source_updated_at` text,
	`source_payload_hash` text NOT NULL,
	`sync_run_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_cost_updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`sync_run_id`) REFERENCES `integration_sync_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "commerce_products_owner_cost_check" CHECK("__new_commerce_products"."owner_cost_cents" is null or "__new_commerce_products"."owner_cost_cents" >= 0),
	CONSTRAINT "commerce_products_owner_cost_source_check" CHECK("__new_commerce_products"."owner_cost_source" is null or "__new_commerce_products"."owner_cost_source" in ('manual','csv'))
);
--> statement-breakpoint
INSERT INTO `__new_commerce_products`("id", "organization_id", "provider", "connection_id", "external_product_id", "sku", "name", "category_ref", "supplier_ref", "default_cost_cents", "owner_cost_cents", "owner_cost_source", "owner_cost_updated_by_user_id", "owner_cost_updated_at", "default_price_cents", "archived", "source_updated_at", "source_payload_hash", "sync_run_id", "updated_at") SELECT "id", "organization_id", "provider", "connection_id", "external_product_id", "sku", "name", "category_ref", "supplier_ref", "default_cost_cents", NULL, NULL, NULL, NULL, "default_price_cents", "archived", "source_updated_at", "source_payload_hash", "sync_run_id", "updated_at" FROM `commerce_products`;--> statement-breakpoint
DROP TABLE `commerce_products`;--> statement-breakpoint
ALTER TABLE `__new_commerce_products` RENAME TO `commerce_products`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_products_external_unique` ON `commerce_products` (`organization_id`,`provider`,`connection_id`,`external_product_id`);--> statement-breakpoint
CREATE INDEX `commerce_products_sku_idx` ON `commerce_products` (`organization_id`,`sku`);--> statement-breakpoint
CREATE INDEX `commerce_products_supplier_idx` ON `commerce_products` (`organization_id`,`provider`,`supplier_ref`);--> statement-breakpoint
CREATE INDEX `commerce_products_owner_cost_idx` ON `commerce_products` (`organization_id`,`owner_cost_updated_at`);
