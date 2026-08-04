CREATE TABLE `account_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`organization_id` text,
	`notification_type` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`delivery_status` text DEFAULT 'in_app' NOT NULL,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "account_notifications_delivery_check" CHECK("account_notifications"."delivery_status" in ('in_app', 'queued', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `account_notifications_user_created_idx` ON `account_notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `account_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email_notifications` integer DEFAULT true NOT NULL,
	`remembered_profile` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
