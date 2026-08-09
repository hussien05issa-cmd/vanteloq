CREATE TABLE `inventory_lot_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`operational_event_id` text,
	`quantity_delta` integer NOT NULL,
	`reason` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operational_event_id`) REFERENCES `operational_events`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_lot_movements_nonzero_check" CHECK("inventory_lot_movements"."quantity_delta" <> 0),
	CONSTRAINT "inventory_lot_movements_reason_check" CHECK("inventory_lot_movements"."reason" in ('receipt', 'sale', 'refund', 'adjustment', 'transfer_in', 'transfer_out', 'waste', 'expiry'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_lot_movements_event_unique` ON `inventory_lot_movements` (`organization_id`,`operational_event_id`,`lot_id`,`reason`);--> statement-breakpoint
CREATE INDEX `inventory_lot_movements_lot_time_idx` ON `inventory_lot_movements` (`organization_id`,`lot_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `inventory_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_ref` text NOT NULL,
	`sku` text NOT NULL,
	`product_name` text NOT NULL,
	`supplier_name` text,
	`lot_number` text DEFAULT '' NOT NULL,
	`batch_number` text DEFAULT '' NOT NULL,
	`manufacturing_date` text,
	`received_date` text NOT NULL,
	`expiration_date` text,
	`best_before_date` text,
	`shelf_life_days` integer,
	`unit_cost_cents` integer,
	`unit_retail_cents` integer,
	`quantity_received` integer NOT NULL,
	`quantity_remaining` integer NOT NULL,
	`storage_notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`source_system` text DEFAULT 'manual' NOT NULL,
	`source_ref` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_lots_quantity_check" CHECK("inventory_lots"."quantity_received" >= 0 and "inventory_lots"."quantity_remaining" >= 0),
	CONSTRAINT "inventory_lots_money_check" CHECK("inventory_lots"."unit_cost_cents" is null or "inventory_lots"."unit_cost_cents" >= 0),
	CONSTRAINT "inventory_lots_retail_check" CHECK("inventory_lots"."unit_retail_cents" is null or "inventory_lots"."unit_retail_cents" >= 0),
	CONSTRAINT "inventory_lots_shelf_life_check" CHECK("inventory_lots"."shelf_life_days" is null or "inventory_lots"."shelf_life_days" > 0),
	CONSTRAINT "inventory_lots_version_check" CHECK("inventory_lots"."version" > 0),
	CONSTRAINT "inventory_lots_status_check" CHECK("inventory_lots"."status" in ('active', 'quarantined', 'depleted', 'expired')),
	CONSTRAINT "inventory_lots_source_check" CHECK("inventory_lots"."source_system" in ('manual', 'purchase_order', 'pos', 'import'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_lots_identity_unique` ON `inventory_lots` (`organization_id`,`location_ref`,`sku`,`lot_number`,`batch_number`,`received_date`);--> statement-breakpoint
CREATE INDEX `inventory_lots_fefo_idx` ON `inventory_lots` (`organization_id`,`location_ref`,`sku`,`expiration_date`,`best_before_date`);--> statement-breakpoint
CREATE INDEX `inventory_lots_risk_idx` ON `inventory_lots` (`organization_id`,`status`,`expiration_date`,`best_before_date`);