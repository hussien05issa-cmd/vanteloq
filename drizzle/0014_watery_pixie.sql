CREATE TABLE `internal_access` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`access_level` text NOT NULL,
	`reason` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`mfa_required` integer DEFAULT true NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "internal_access_level_check" CHECK("internal_access"."access_level" in ('founder')),
	CONSTRAINT "internal_access_reason_check" CHECK(length("internal_access"."reason") between 3 and 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `internal_access_user_workspace_level_unique` ON `internal_access` (`user_id`,`organization_id`,`access_level`);--> statement-breakpoint
CREATE INDEX `internal_access_workspace_active_idx` ON `internal_access` (`organization_id`,`active`);--> statement-breakpoint
ALTER TABLE `users` ADD `auth_subject` text;--> statement-breakpoint
ALTER TABLE `users` ADD `auth_provider` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_auth_subject_unique` ON `users` (`auth_subject`);
