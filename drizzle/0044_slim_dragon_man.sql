CREATE TABLE `integration_sync_schedules` (
	`connection_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`authorized_by_user_id` text NOT NULL,
	`authorized_subject` text NOT NULL,
	`authorization_version` text NOT NULL,
	`authorized_at` integer NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`interval_seconds` integer DEFAULT 900 NOT NULL,
	`next_run_at` integer NOT NULL,
	`last_started_at` integer,
	`last_finished_at` integer,
	`last_status` text DEFAULT 'queued' NOT NULL,
	`last_error_code` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`authorized_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "integration_sync_schedules_interval_check" CHECK("integration_sync_schedules"."interval_seconds" between 900 and 86400)
);
--> statement-breakpoint
CREATE INDEX `integration_sync_schedules_due_idx` ON `integration_sync_schedules` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `integration_sync_schedules_workspace_idx` ON `integration_sync_schedules` (`organization_id`);--> statement-breakpoint
CREATE TABLE `integration_sync_ticks` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `integration_sync_ticks_created_idx` ON `integration_sync_ticks` (`created_at`);