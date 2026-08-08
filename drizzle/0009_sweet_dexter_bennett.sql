CREATE TABLE `inventory_balances` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_ref` text NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`on_hand_quantity` integer DEFAULT 0 NOT NULL,
	`reorder_point` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "inventory_balances_reorder_check" CHECK("inventory_balances"."reorder_point" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_balances_workspace_location_sku_unique` ON `inventory_balances` (`organization_id`,`location_ref`,`sku`);--> statement-breakpoint
CREATE INDEX `inventory_balances_workspace_stock_idx` ON `inventory_balances` (`organization_id`,`on_hand_quantity`);--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`operational_event_id` text NOT NULL,
	`location_ref` text NOT NULL,
	`sku` text NOT NULL,
	`item_name` text NOT NULL,
	`quantity_delta` integer NOT NULL,
	`reason` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operational_event_id`) REFERENCES `operational_events`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "inventory_movements_nonzero_check" CHECK("inventory_movements"."quantity_delta" <> 0),
	CONSTRAINT "inventory_movements_reason_check" CHECK("inventory_movements"."reason" in ('sale', 'refund', 'receipt', 'adjustment'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_movements_event_sku_unique` ON `inventory_movements` (`operational_event_id`,`location_ref`,`sku`);--> statement-breakpoint
CREATE INDEX `inventory_movements_workspace_sku_idx` ON `inventory_movements` (`organization_id`,`sku`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `operational_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_type` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`source_system` text NOT NULL,
	`source_event_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "operational_events_type_check" CHECK("operational_events"."event_type" in ('payment.settled', 'inventory.depleted', 'message.queued', 'message.sent', 'message.failed')),
	CONSTRAINT "operational_events_aggregate_check" CHECK("operational_events"."aggregate_type" in ('sale', 'inventory', 'message'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operational_events_source_unique` ON `operational_events` (`organization_id`,`source_system`,`source_event_id`,`event_type`);--> statement-breakpoint
CREATE INDEX `operational_events_workspace_cursor_idx` ON `operational_events` (`organization_id`,`recorded_at`,`id`);--> statement-breakpoint
CREATE TABLE `outbound_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`operational_event_id` text NOT NULL,
	`channel` text DEFAULT 'email' NOT NULL,
	`recipient` text NOT NULL,
	`subject` text NOT NULL,
	`body_text` text NOT NULL,
	`status` text DEFAULT 'held' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`provider_message_ref` text,
	`last_error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operational_event_id`) REFERENCES `operational_events`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "outbound_messages_status_check" CHECK("outbound_messages"."status" in ('held', 'queued', 'sending', 'sent', 'failed')),
	CONSTRAINT "outbound_messages_attempt_check" CHECK("outbound_messages"."attempt_count" >= 0 and "outbound_messages"."attempt_count" <= 20)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbound_messages_event_channel_unique` ON `outbound_messages` (`operational_event_id`,`channel`);--> statement-breakpoint
CREATE INDEX `outbound_messages_workspace_status_idx` ON `outbound_messages` (`organization_id`,`status`,`next_attempt_at`);