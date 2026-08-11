CREATE TABLE `marketing_calendar_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`title` text NOT NULL,
	`channel` text NOT NULL,
	`event_type` text NOT NULL,
	`start_date` text NOT NULL,
	`due_date` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "marketing_calendar_status_check" CHECK("marketing_calendar_entries"."status" in ('planned','in_progress','completed','cancelled'))
);
--> statement-breakpoint
CREATE INDEX `marketing_calendar_workspace_date_idx` ON `marketing_calendar_entries` (`organization_id`,`start_date`);--> statement-breakpoint
CREATE TABLE `marketing_profiles` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`business_model` text DEFAULT '' NOT NULL,
	`primary_offer` text DEFAULT '' NOT NULL,
	`target_audience` text DEFAULT '' NOT NULL,
	`service_area` text DEFAULT '' NOT NULL,
	`primary_goal` text DEFAULT 'leads' NOT NULL,
	`website_url` text DEFAULT '' NOT NULL,
	`google_profile_status` text DEFAULT 'not_set' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "marketing_profiles_goal_check" CHECK("marketing_profiles"."primary_goal" in ('leads','visits','sales','awareness')),
	CONSTRAINT "marketing_profiles_google_check" CHECK("marketing_profiles"."google_profile_status" in ('not_set','claimed','verified'))
);
