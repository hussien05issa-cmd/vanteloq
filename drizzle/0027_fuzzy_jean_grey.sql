DELETE FROM `marketing_daily_metrics` WHERE `provider` IN ('google', 'meta');
--> statement-breakpoint
UPDATE `integration_connections`
SET `data_promotion_status` = 'staging', `last_successful_sync_at` = NULL, `last_error_code` = NULL
WHERE `provider` IN ('google', 'meta') AND `status` = 'connected';
--> statement-breakpoint
CREATE TABLE `integration_source_authorities` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`local_location_id` text NOT NULL,
	`channel` text NOT NULL,
	`fact_family` text NOT NULL,
	`provider` text NOT NULL,
	`connection_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`local_location_id`) REFERENCES `organization_locations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "integration_source_authorities_channel_check" CHECK("integration_source_authorities"."channel" in ('retail','ecommerce','marketplace','delivery')),
	CONSTRAINT "integration_source_authorities_family_check" CHECK("integration_source_authorities"."fact_family" in ('sales','payments','inventory','products','customers','suppliers')),
	CONSTRAINT "integration_source_authorities_version_check" CHECK("integration_source_authorities"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_source_authorities_scope_unique` ON `integration_source_authorities` (`organization_id`,`local_location_id`,`channel`,`fact_family`);--> statement-breakpoint
CREATE INDEX `integration_source_authorities_connection_idx` ON `integration_source_authorities` (`organization_id`,`connection_id`);--> statement-breakpoint
DROP TABLE `marketing_reviews`;
