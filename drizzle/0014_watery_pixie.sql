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
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`auth_subject` text,
	`auth_provider` text,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "users_auth_provider_check" CHECK("__new_users"."auth_provider" is null or "__new_users"."auth_provider" in ('supabase','sites')),
	CONSTRAINT "users_status_check" CHECK("__new_users"."status" in ('active', 'suspended'))
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "email", "auth_subject", "auth_provider", "display_name", "status", "created_at", "updated_at") SELECT "id", "email", NULL, NULL, "display_name", "status", "created_at", "updated_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_auth_subject_unique` ON `users` (`auth_subject`);
