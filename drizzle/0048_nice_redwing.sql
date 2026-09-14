CREATE TABLE `opportunity_review_events` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`actor_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `opportunity_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `opportunity_event_review_version_unique` ON `opportunity_review_events` (`review_id`,`version`);--> statement-breakpoint
CREATE INDEX `opportunity_event_org_review_idx` ON `opportunity_review_events` (`organization_id`,`review_id`);--> statement-breakpoint
CREATE TABLE `opportunity_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`scope_key` text NOT NULL,
	`scope_label` text NOT NULL,
	`rule_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`required_permissions_json` text NOT NULL,
	`status` text NOT NULL,
	`snoozed_until` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`mutation_key` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "opportunity_review_status_check" CHECK("opportunity_reviews"."status" in ('reviewed','monitoring','snoozed','resolved','dismissed')),
	CONSTRAINT "opportunity_review_version_check" CHECK("opportunity_reviews"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `opportunity_review_scope_period_unique` ON `opportunity_reviews` (`organization_id`,`scope_key`,`rule_id`,`period_start`,`period_end`);--> statement-breakpoint
CREATE INDEX `opportunity_review_scope_updated_idx` ON `opportunity_reviews` (`organization_id`,`scope_key`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_tasks_opportunity_unique` ON `workspace_tasks` (`organization_id`,`source_ref`) WHERE "workspace_tasks"."source_type" = 'decision' AND "workspace_tasks"."source_ref" LIKE 'opportunity:%';