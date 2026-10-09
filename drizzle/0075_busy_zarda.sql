CREATE TABLE `collaboration_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text,
	`task_id` integer,
	`author_user_id` text,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `organization_locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `workspace_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "collaboration_message_length" CHECK(length("collaboration_messages"."body") BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collaboration_message_request_unique` ON `collaboration_messages` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `collaboration_message_channel_idx` ON `collaboration_messages` (`organization_id`,`location_id`,`id`);--> statement-breakpoint
CREATE INDEX `collaboration_message_task_idx` ON `collaboration_messages` (`organization_id`,`task_id`,`id`);--> statement-breakpoint
ALTER TABLE `integration_staged_sales` ADD `units_milli` integer;--> statement-breakpoint
ALTER TABLE `workspace_tasks` ADD `assignee_user_id` text REFERENCES users(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `workspace_tasks` ADD `location_id` text REFERENCES organization_locations(id);--> statement-breakpoint
ALTER TABLE `workspace_tasks` ADD `version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
-- Add after the generated nullable units_milli schema change. Retain all source
-- and canonical records. Existing approval alone cannot certify legacy maths.
UPDATE integration_connections
SET data_promotion_status = 'staging',
    promotion_authorized_at = NULL,
    last_error_code = 'POS_FINANCIAL_HISTORY_REVIEW_REQUIRED'
WHERE provider IN ('shopify', 'shopify-pos', 'lightspeed-r')
  AND data_promotion_status = 'approved';
