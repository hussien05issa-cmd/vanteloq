CREATE TABLE `free_plan_enrollments` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`policy_version` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `free_plan_usage` (
	`organization_id` text NOT NULL,
	`month` text NOT NULL,
	`metric` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`organization_id`, `month`, `metric`),
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "free_plan_usage_nonnegative" CHECK("free_plan_usage"."used" >= 0)
);
