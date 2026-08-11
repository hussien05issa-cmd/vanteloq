CREATE TABLE `marketing_daily_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`provider` text NOT NULL,
	`resource_ref` text NOT NULL,
	`metric_date` text NOT NULL,
	`metric_key` text NOT NULL,
	`value_milli` integer NOT NULL,
	`source_event_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "marketing_daily_metrics_provider_check" CHECK("marketing_daily_metrics"."provider" in ('google','meta')),
	CONSTRAINT "marketing_daily_metrics_value_check" CHECK("marketing_daily_metrics"."value_milli" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `marketing_daily_metrics_source_unique` ON `marketing_daily_metrics` (`connection_id`,`source_event_id`);--> statement-breakpoint
CREATE INDEX `marketing_daily_metrics_workspace_date_idx` ON `marketing_daily_metrics` (`organization_id`,`metric_date`);--> statement-breakpoint
CREATE INDEX `marketing_daily_metrics_provider_metric_idx` ON `marketing_daily_metrics` (`organization_id`,`provider`,`metric_key`,`metric_date`);--> statement-breakpoint
CREATE TABLE `marketing_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`provider` text DEFAULT 'google' NOT NULL,
	`external_location_ref` text NOT NULL,
	`external_review_ref` text NOT NULL,
	`rating_milli` integer NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`reviewed_at` text NOT NULL,
	`source_updated_at` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "marketing_reviews_provider_check" CHECK("marketing_reviews"."provider" = 'google'),
	CONSTRAINT "marketing_reviews_rating_check" CHECK("marketing_reviews"."rating_milli" >= 1000 and "marketing_reviews"."rating_milli" <= 5000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `marketing_reviews_connection_review_unique` ON `marketing_reviews` (`connection_id`,`external_review_ref`);--> statement-breakpoint
CREATE INDEX `marketing_reviews_workspace_date_idx` ON `marketing_reviews` (`organization_id`,`reviewed_at`);