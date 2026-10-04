CREATE TABLE `business_workflow_records` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`content_json` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`mutation_id` text NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `organization_locations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "business_workflow_kind" CHECK("business_workflow_records"."kind" IN ('job','settlement','order_margin','outcome','custom')),
	CONSTRAINT "business_workflow_state" CHECK("business_workflow_records"."state" IN ('draft','reviewed','completed')),
	CONSTRAINT "business_workflow_json" CHECK(json_valid("business_workflow_records"."content_json")),
	CONSTRAINT "business_workflow_version" CHECK("business_workflow_records"."version">0)
);
--> statement-breakpoint
CREATE INDEX `business_workflow_scope` ON `business_workflow_records` (`organization_id`,`location_id`,`kind`,`updated_at`);--> statement-breakpoint
CREATE TABLE `business_workflow_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`record_id` text NOT NULL,
	`version` integer NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`snapshot_json` text NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`record_id`) REFERENCES `business_workflow_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "business_workflow_snapshot" CHECK(json_valid("business_workflow_revisions"."snapshot_json"))
);
--> statement-breakpoint
CREATE INDEX `business_workflow_history` ON `business_workflow_revisions` (`organization_id`,`record_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `business_workflow_revision_number` ON `business_workflow_revisions` (`record_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `business_workflow_request` ON `business_workflow_revisions` (`organization_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `collection_followup_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`followup_id` text NOT NULL,
	`version` integer NOT NULL,
	`payload_json` text NOT NULL,
	`actor_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`followup_id`) REFERENCES `collection_followups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "collection_followup_event_json" CHECK(json_valid("collection_followup_events"."payload_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_followup_event_version` ON `collection_followup_events` (`followup_id`,`version`);--> statement-breakpoint
CREATE TABLE `collection_followups` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`approved_recipient` text DEFAULT '' NOT NULL,
	`approved_total_cents` integer DEFAULT 0 NOT NULL,
	`approved_currency` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`mutation_key` text NOT NULL,
	`last_checked_at` integer DEFAULT 0 NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `customer_invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "collection_followup_json" CHECK(json_valid("collection_followups"."payload_json")),
	CONSTRAINT "collection_followup_version" CHECK("collection_followups"."version">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_followup_invoice` ON `collection_followups` (`organization_id`,`invoice_id`);--> statement-breakpoint
CREATE TABLE `workflow_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`scope_key` text NOT NULL,
	`business_date` text NOT NULL,
	`invoice_id` text,
	`preference_version` integer NOT NULL,
	`followup_version` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`provider_id` text,
	`error_code` text,
	`acknowledged_at` integer,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `customer_invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workflow_delivery_payload_json" CHECK(json_valid("workflow_deliveries"."payload_json")),
	CONSTRAINT "workflow_delivery_attempts" CHECK("workflow_deliveries"."attempts">=0)
);
--> statement-breakpoint
CREATE INDEX `workflow_delivery_retry` ON `workflow_deliveries` (`status`,`next_attempt_at`,`lease_expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_delivery_once` ON `workflow_deliveries` (`organization_id`,`kind`,`scope_key`);--> statement-breakpoint
CREATE TABLE `workflow_delivery_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`authorized_subject` text NOT NULL,
	`approved_email` text NOT NULL,
	`authorization_version` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`mutation_key` text NOT NULL,
	`last_checked_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workflow_delivery_preferences_json" CHECK(json_valid("workflow_delivery_preferences"."payload_json")),
	CONSTRAINT "workflow_delivery_preferences_version" CHECK("workflow_delivery_preferences"."version">0)
);
--> statement-breakpoint
CREATE INDEX `workflow_delivery_due` ON `workflow_delivery_preferences` (`enabled`,`last_checked_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_delivery_owner` ON `workflow_delivery_preferences` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `sector_operation_records` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`kind` text NOT NULL,
	`record_key` text NOT NULL,
	`currency` text NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`content_json` text NOT NULL,
	`linked_json` text DEFAULT '[]' NOT NULL,
	`last_request_id` text NOT NULL,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `organization_locations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "sector_record_kind" CHECK("sector_operation_records"."kind" IN ('prep_plan','prep_batch','supplier_check','service_period','delivery_order','furniture_order','dealer_funding','room','reservation')),
	CONSTRAINT "sector_record_state" CHECK("sector_operation_records"."state" IN ('draft','reviewed','active','completed','cancelled')),
	CONSTRAINT "sector_record_version" CHECK("sector_operation_records"."version">0),
	CONSTRAINT "sector_record_json" CHECK(json_valid("sector_operation_records"."content_json") AND json_valid("sector_operation_records"."linked_json"))
);
--> statement-breakpoint
CREATE INDEX `sector_record_scope` ON `sector_operation_records` (`organization_id`,`location_id`,`kind`,`state`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `sector_record_tenant_id` ON `sector_operation_records` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sector_record_business_key` ON `sector_operation_records` (`organization_id`,`location_id`,`kind`,`record_key`);--> statement-breakpoint
CREATE TABLE `sector_operation_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`record_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`request_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`result_json` text NOT NULL,
	`success` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`record_id`) REFERENCES `sector_operation_records`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sector_request_committed" CHECK("sector_operation_requests"."success"=1),
	CONSTRAINT "sector_request_json" CHECK(json_valid("sector_operation_requests"."result_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sector_request_key` ON `sector_operation_requests` (`organization_id`,`actor_id`,`request_key`);--> statement-breakpoint
CREATE TABLE `sector_operation_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`record_id` text NOT NULL,
	`version` integer NOT NULL,
	`action` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`state` text NOT NULL,
	`content_json` text NOT NULL,
	`linked_json` text NOT NULL,
	`actor_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`,`record_id`) REFERENCES `sector_operation_records`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sector_revision_json" CHECK(json_valid("sector_operation_revisions"."content_json") AND json_valid("sector_operation_revisions"."linked_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sector_revision_version` ON `sector_operation_revisions` (`organization_id`,`record_id`,`version`);--> statement-breakpoint
CREATE TABLE `sector_room_nights` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`record_id` text NOT NULL,
	`room_id` text NOT NULL,
	`stay_date` text NOT NULL,
	FOREIGN KEY (`organization_id`,`record_id`) REFERENCES `sector_operation_records`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`room_id`) REFERENCES `sector_operation_records`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sector_room_night_record` ON `sector_room_nights` (`organization_id`,`record_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sector_room_night_booking` ON `sector_room_nights` (`organization_id`,`room_id`,`stay_date`);--> statement-breakpoint
CREATE TABLE `workflow_inventory_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`permitted` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workflow_inventory_guard_passed" CHECK("workflow_inventory_guards"."permitted"=1)
);
--> statement-breakpoint
CREATE TABLE `workflow_inventory_history` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`record_id` text NOT NULL,
	`version` integer NOT NULL,
	`payload_json` text NOT NULL,
	`actor_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`record_id`) REFERENCES `workflow_inventory_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "workflow_inventory_history_json" CHECK(json_valid("workflow_inventory_history"."payload_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_inventory_history_version` ON `workflow_inventory_history` (`record_id`,`version`);--> statement-breakpoint
CREATE TABLE `workflow_inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`position_id` text NOT NULL,
	`quantity_delta` integer NOT NULL,
	`reason` text NOT NULL,
	`source_reference` text NOT NULL,
	`occurred_date` text NOT NULL,
	`actor_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`position_id`) REFERENCES `workflow_inventory_positions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_inventory_movement_source` ON `workflow_inventory_movements` (`organization_id`,`position_id`,`source_reference`);--> statement-breakpoint
CREATE INDEX `workflow_inventory_movement_history` ON `workflow_inventory_movements` (`organization_id`,`position_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `workflow_inventory_mutations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`mutation_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workflow_inventory_mutation_json" CHECK(json_valid("workflow_inventory_mutations"."result_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_inventory_mutation_key` ON `workflow_inventory_mutations` (`organization_id`,`mutation_key`);--> statement-breakpoint
CREATE TABLE `workflow_inventory_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`sku` text NOT NULL,
	`product_name` text NOT NULL,
	`unit` text NOT NULL,
	`currency` text NOT NULL,
	`quantity_milli` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `organization_locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workflow_inventory_position_valid" CHECK("workflow_inventory_positions"."quantity_milli" >= 0 AND "workflow_inventory_positions"."quantity_milli" <= 1000000000000 AND "workflow_inventory_positions"."version" > 0 AND "workflow_inventory_positions"."unit" IN ('each','g','ml'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_inventory_position_key` ON `workflow_inventory_positions` (`organization_id`,`location_id`,`sku`);--> statement-breakpoint
CREATE TABLE `workflow_inventory_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`purchase_order_id` text NOT NULL,
	`source` text NOT NULL,
	`occurred_date` text NOT NULL,
	`lines_json` text NOT NULL,
	`reversed_at` integer,
	`reversal_reason` text,
	`actor_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `organization_locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "workflow_inventory_receipts_json" CHECK(json_valid("workflow_inventory_receipts"."lines_json"))
);
--> statement-breakpoint
CREATE INDEX `workflow_inventory_receipts_scope` ON `workflow_inventory_receipts` (`organization_id`,`location_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `workflow_inventory_records` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`kind` text NOT NULL,
	`record_key` text NOT NULL,
	`currency` text NOT NULL,
	`payload_json` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`actor_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `organization_locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "workflow_inventory_record_valid" CHECK(json_valid("workflow_inventory_records"."payload_json") AND "workflow_inventory_records"."version">0 AND "workflow_inventory_records"."kind" IN ('supplier','lot_case','returns','invoice_review'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_inventory_record_key` ON `workflow_inventory_records` (`organization_id`,`location_id`,`kind`,`record_key`);