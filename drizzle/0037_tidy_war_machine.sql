CREATE TABLE `management_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`contact_id` text,
	`contact_name` text DEFAULT '' NOT NULL,
	`contact_email` text DEFAULT '' NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`location` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`outcome` text DEFAULT '' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `management_contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "management_activities_company_check" CHECK("management_activities"."company" in ('lexedge','vanteloq')),
	CONSTRAINT "management_activities_kind_check" CHECK("management_activities"."kind" in ('call','meeting','follow_up','deadline')),
	CONSTRAINT "management_activities_status_check" CHECK("management_activities"."status" in ('scheduled','completed','cancelled','no_show')),
	CONSTRAINT "management_activities_title_check" CHECK(length("management_activities"."title") between 1 and 200)
);
--> statement-breakpoint
CREATE INDEX `management_activities_company_start_idx` ON `management_activities` (`company`,`starts_at`);--> statement-breakpoint
CREATE INDEX `management_activities_status_idx` ON `management_activities` (`status`,`starts_at`);--> statement-breakpoint
CREATE TABLE `management_console_access` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`user_id` text,
	`role` text NOT NULL,
	`scopes_json` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`mfa_required` integer DEFAULT true NOT NULL,
	`granted_by_user_id` text NOT NULL,
	`last_accessed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`granted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "management_console_access_role_check" CHECK("management_console_access"."role" in ('admin','viewer')),
	CONSTRAINT "management_console_access_email_check" CHECK(length("management_console_access"."email") between 3 and 255 and instr("management_console_access"."email", '@') > 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `management_console_access_email_unique` ON `management_console_access` (`email`);--> statement-breakpoint
CREATE INDEX `management_console_access_active_idx` ON `management_console_access` (`active`,`role`);--> statement-breakpoint
CREATE TABLE `management_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`name` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`organization` text DEFAULT '' NOT NULL,
	`stage` text DEFAULT 'lead' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`owner` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`last_contact_at` integer,
	`next_follow_up_at` integer,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "management_contacts_company_check" CHECK("management_contacts"."company" in ('lexedge','vanteloq')),
	CONSTRAINT "management_contacts_stage_check" CHECK("management_contacts"."stage" in ('lead','prospect','client','partner','inactive')),
	CONSTRAINT "management_contacts_name_check" CHECK(length("management_contacts"."name") between 1 and 160)
);
--> statement-breakpoint
CREATE INDEX `management_contacts_company_stage_idx` ON `management_contacts` (`company`,`stage`);--> statement-breakpoint
CREATE INDEX `management_contacts_follow_up_idx` ON `management_contacts` (`company`,`next_follow_up_at`);--> statement-breakpoint
CREATE TABLE `management_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`title` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`due_at` integer,
	`assignee` text DEFAULT '' NOT NULL,
	`contact_id` text,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `management_contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "management_tasks_company_check" CHECK("management_tasks"."company" in ('lexedge','vanteloq')),
	CONSTRAINT "management_tasks_priority_check" CHECK("management_tasks"."priority" in ('high','medium','low')),
	CONSTRAINT "management_tasks_status_check" CHECK("management_tasks"."status" in ('open','in_progress','done')),
	CONSTRAINT "management_tasks_title_check" CHECK(length("management_tasks"."title") between 1 and 200)
);
--> statement-breakpoint
CREATE INDEX `management_tasks_company_status_idx` ON `management_tasks` (`company`,`status`);--> statement-breakpoint
CREATE INDEX `management_tasks_due_idx` ON `management_tasks` (`status`,`due_at`);
