CREATE TABLE `integration_location_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_location_ref` text NOT NULL,
	`external_name` text NOT NULL,
	`local_location_id` text,
	`status` text DEFAULT 'unmapped' NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "integration_location_mappings_status_check" CHECK("integration_location_mappings"."status" in ('unmapped', 'mapped', 'ignored'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_location_mappings_external_unique` ON `integration_location_mappings` (`organization_id`,`provider`,`external_location_ref`);--> statement-breakpoint
CREATE INDEX `integration_location_mappings_status_idx` ON `integration_location_mappings` (`organization_id`,`provider`,`status`);--> statement-breakpoint
CREATE TABLE `integration_oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`provider` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `integration_oauth_states_expiry_idx` ON `integration_oauth_states` (`provider`,`expires_at`);--> statement-breakpoint
CREATE TABLE `integration_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`access_token_ciphertext` text NOT NULL,
	`refresh_token_ciphertext` text NOT NULL,
	`token_expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_secrets_workspace_provider_unique` ON `integration_secrets` (`organization_id`,`provider`);--> statement-breakpoint
CREATE INDEX `integration_secrets_expiry_idx` ON `integration_secrets` (`provider`,`token_expires_at`);--> statement-breakpoint
CREATE TABLE `integration_staged_sales` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_sale_id` text NOT NULL,
	`external_version` text NOT NULL,
	`outlet_ref` text,
	`sold_at` text,
	`state` text NOT NULL,
	`total_cents` integer NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`cost_cents` integer DEFAULT 0 NOT NULL,
	`discount_cents` integer DEFAULT 0 NOT NULL,
	`line_count` integer DEFAULT 0 NOT NULL,
	`source_payload_hash` text NOT NULL,
	`sync_run_id` text NOT NULL,
	`staged_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sync_run_id`) REFERENCES `integration_sync_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "integration_staged_sales_counts_check" CHECK("integration_staged_sales"."line_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_staged_sales_version_unique` ON `integration_staged_sales` (`organization_id`,`provider`,`external_sale_id`,`external_version`);--> statement-breakpoint
CREATE INDEX `integration_staged_sales_outlet_date_idx` ON `integration_staged_sales` (`organization_id`,`provider`,`outlet_ref`,`sold_at`);--> statement-breakpoint
CREATE TABLE `integration_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`cursor_before` text,
	`cursor_after` text,
	`records_read` integer DEFAULT 0 NOT NULL,
	`records_staged` integer DEFAULT 0 NOT NULL,
	`duplicates_skipped` integer DEFAULT 0 NOT NULL,
	`warning_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`created_by_user_id` text,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "integration_sync_runs_mode_check" CHECK("integration_sync_runs"."mode" in ('discovery', 'sample', 'incremental', 'webhook_recovery')),
	CONSTRAINT "integration_sync_runs_status_check" CHECK("integration_sync_runs"."status" in ('running', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `integration_sync_runs_workspace_provider_idx` ON `integration_sync_runs` (`organization_id`,`provider`,`started_at`);--> statement-breakpoint
CREATE TABLE `integration_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`payload_hash` text NOT NULL,
	`signature_hash` text NOT NULL,
	`event_type` text NOT NULL,
	`external_object_ref` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "integration_webhook_events_status_check" CHECK("integration_webhook_events"."status" in ('queued', 'processed', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_webhook_events_replay_unique` ON `integration_webhook_events` (`organization_id`,`provider`,`payload_hash`);--> statement-breakpoint
CREATE INDEX `integration_webhook_events_status_idx` ON `integration_webhook_events` (`organization_id`,`provider`,`status`,`received_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_integration_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'not_connected' NOT NULL,
	`external_account_ref` text,
	`domain_prefix` text,
	`api_version` text,
	`scopes_json` text DEFAULT '[]' NOT NULL,
	`data_promotion_status` text DEFAULT 'blocked' NOT NULL,
	`connected_at` integer,
	`last_successful_sync_at` integer,
	`last_sync_cursor` text,
	`last_error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "integration_connections_status_check" CHECK("__new_integration_connections"."status" in ('not_connected', 'pending', 'connected', 'error', 'revoked')),
	CONSTRAINT "integration_connections_promotion_check" CHECK("__new_integration_connections"."data_promotion_status" in ('blocked', 'staging', 'approved'))
);
--> statement-breakpoint
INSERT INTO `__new_integration_connections`("id", "organization_id", "provider", "status", "external_account_ref", "domain_prefix", "api_version", "scopes_json", "data_promotion_status", "connected_at", "last_successful_sync_at", "last_sync_cursor", "last_error_code", "created_at", "updated_at") SELECT "id", "organization_id", "provider", "status", "external_account_ref", NULL, NULL, "scopes_json", 'blocked', NULL, "last_successful_sync_at", NULL, "last_error_code", "created_at", "updated_at" FROM `integration_connections`;--> statement-breakpoint
DROP TABLE `integration_connections`;--> statement-breakpoint
ALTER TABLE `__new_integration_connections` RENAME TO `integration_connections`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `integration_connections_workspace_provider_unique` ON `integration_connections` (`organization_id`,`provider`);
