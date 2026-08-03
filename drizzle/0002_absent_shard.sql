CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`actor_user_id` text,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`outcome` text NOT NULL,
	`request_id` text NOT NULL,
	`source_hash` text,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "audit_events_outcome_check" CHECK("audit_events"."outcome" in ('success', 'failure'))
);
--> statement-breakpoint
CREATE INDEX `audit_events_workspace_created_idx` ON `audit_events` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_actor_created_idx` ON `audit_events` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `integration_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'not_connected' NOT NULL,
	`external_account_ref` text,
	`scopes_json` text DEFAULT '[]' NOT NULL,
	`last_successful_sync_at` integer,
	`last_error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "integration_connections_status_check" CHECK("integration_connections"."status" in ('not_connected', 'pending', 'connected', 'error', 'revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_connections_workspace_provider_unique` ON `integration_connections` (`organization_id`,`provider`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memberships_role_check" CHECK("memberships"."role" in ('owner', 'admin', 'manager', 'employee', 'read_only', 'integration')),
	CONSTRAINT "memberships_status_check" CHECK("memberships"."status" in ('active', 'suspended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_user_unique` ON `memberships` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_user_workspace_unique` ON `memberships` (`user_id`,`organization_id`);--> statement-breakpoint
CREATE INDEX `memberships_workspace_idx` ON `memberships` (`organization_id`);--> statement-breakpoint
CREATE TABLE `rate_limit_buckets` (
	`bucket_key` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`actor_hash` text NOT NULL,
	`window_start` integer NOT NULL,
	`request_count` integer DEFAULT 1 NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "users_status_check" CHECK("users"."status" in ('active', 'suspended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workspace_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` text NOT NULL,
	`title` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`assignee` text DEFAULT 'Owner' NOT NULL,
	`due_date` text,
	`created_by_user_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workspace_tasks_priority_check" CHECK("workspace_tasks"."priority" in ('high', 'medium', 'low')),
	CONSTRAINT "workspace_tasks_status_check" CHECK("workspace_tasks"."status" in ('open', 'in_progress', 'done'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_tasks_idempotency_unique` ON `workspace_tasks` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `workspace_tasks_workspace_status_idx` ON `workspace_tasks` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `workspace_tasks_workspace_created_idx` ON `workspace_tasks` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_name` text NOT NULL,
	`business_name` text NOT NULL,
	`legal_name` text NOT NULL,
	`business_email` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`industry` text NOT NULL,
	`country` text DEFAULT 'Canada' NOT NULL,
	`province` text DEFAULT '' NOT NULL,
	`city` text NOT NULL,
	`address` text NOT NULL,
	`postal_code` text NOT NULL,
	`timezone` text DEFAULT 'America/Toronto' NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`fiscal_year_start` text DEFAULT 'January' NOT NULL,
	`tax_number` text DEFAULT '' NOT NULL,
	`hours_json` text NOT NULL,
	`source_mode` text DEFAULT 'connect_later' NOT NULL,
	`selected_pos` text DEFAULT '' NOT NULL,
	`setup_complete` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "workspaces_source_mode_check" CHECK("workspaces"."source_mode" in ('connect_later', 'csv', 'live'))
);
--> statement-breakpoint
CREATE INDEX `workspaces_business_name_idx` ON `workspaces` (`business_name`);--> statement-breakpoint
INSERT OR IGNORE INTO `users` (`id`, `email`, `display_name`, `status`, `created_at`, `updated_at`)
SELECT 'legacy-user-' || `id`, lower(`owner_email`), `owner_name`, 'active', `created_at`, `updated_at`
FROM `organizations`;--> statement-breakpoint
INSERT OR IGNORE INTO `workspaces` (
	`id`, `owner_name`, `business_name`, `legal_name`, `business_email`, `phone`, `website`, `industry`,
	`country`, `province`, `city`, `address`, `postal_code`, `timezone`, `currency`, `fiscal_year_start`,
	`tax_number`, `hours_json`, `source_mode`, `selected_pos`, `setup_complete`, `created_at`, `updated_at`
)
SELECT
	'legacy-workspace-' || `id`, `owner_name`, `business_name`, `legal_name`, `business_email`, `phone`, `website`, `industry`,
	`country`, `province`, `city`, `address`, `postal_code`, `timezone`, `currency`, `fiscal_year_start`,
	`tax_number`, `hours_json`, `source_mode`, `selected_pos`, `setup_complete`, `created_at`, `updated_at`
FROM `organizations`;--> statement-breakpoint
INSERT OR IGNORE INTO `memberships` (`id`, `user_id`, `organization_id`, `role`, `status`, `created_at`, `updated_at`)
SELECT 'legacy-membership-' || `id`, 'legacy-user-' || `id`, 'legacy-workspace-' || `id`, 'owner', 'active', `created_at`, `updated_at`
FROM `organizations`;--> statement-breakpoint
INSERT OR IGNORE INTO `workspace_tasks` (
	`organization_id`, `title`, `detail`, `priority`, `status`, `assignee`, `due_date`,
	`created_by_user_id`, `idempotency_key`, `created_at`, `updated_at`
)
SELECT
	'legacy-workspace-' || owner.`id`, task.`title`, task.`detail`, task.`priority`, task.`status`, task.`assignee`, task.`due_date`,
	'legacy-user-' || owner.`id`, 'legacy-task-' || task.`id`, task.`created_at`, task.`updated_at`
FROM `tasks` task
JOIN `organizations` owner ON owner.`id` = (SELECT min(`id`) FROM `organizations`);--> statement-breakpoint
INSERT OR IGNORE INTO `audit_events` (
	`id`, `organization_id`, `actor_user_id`, `action`, `resource_type`, `resource_id`,
	`outcome`, `request_id`, `source_hash`, `details_json`, `created_at`
)
SELECT
	'legacy-audit-' || `id`, 'legacy-workspace-' || `id`, 'legacy-user-' || `id`, 'workspace.migrated',
	'workspace', 'legacy-workspace-' || `id`, 'success', 'migration-0002', NULL, '{}', `updated_at`
FROM `organizations`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_organizations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_email` text NOT NULL,
	`owner_name` text NOT NULL,
	`business_name` text NOT NULL,
	`legal_name` text NOT NULL,
	`business_email` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`industry` text NOT NULL,
	`country` text DEFAULT 'Canada' NOT NULL,
	`province` text DEFAULT '' NOT NULL,
	`city` text NOT NULL,
	`address` text NOT NULL,
	`postal_code` text NOT NULL,
	`timezone` text DEFAULT 'America/Toronto' NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`fiscal_year_start` text DEFAULT 'January' NOT NULL,
	`tax_number` text DEFAULT '' NOT NULL,
	`hours_json` text NOT NULL,
	`source_mode` text DEFAULT 'connect_later' NOT NULL,
	`selected_pos` text DEFAULT '' NOT NULL,
	`setup_complete` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_organizations`("id", "owner_email", "owner_name", "business_name", "legal_name", "business_email", "phone", "website", "industry", "country", "province", "city", "address", "postal_code", "timezone", "currency", "fiscal_year_start", "tax_number", "hours_json", "source_mode", "selected_pos", "setup_complete", "created_at", "updated_at") SELECT "id", "owner_email", "owner_name", "business_name", "legal_name", "business_email", "phone", "website", "industry", "country", "province", "city", "address", "postal_code", "timezone", "currency", "fiscal_year_start", "tax_number", "hours_json", "source_mode", "selected_pos", "setup_complete", "created_at", "updated_at" FROM `organizations`;--> statement-breakpoint
DROP TABLE `organizations`;--> statement-breakpoint
ALTER TABLE `__new_organizations` RENAME TO `organizations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_owner_email_unique` ON `organizations` (`owner_email`);
