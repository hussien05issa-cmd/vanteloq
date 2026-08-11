CREATE TABLE `marketing_resource_selections` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`provider` text NOT NULL,
	`dataset` text NOT NULL,
	`external_resource_ref` text NOT NULL,
	`external_resource_name` text NOT NULL,
	`scope_kind` text NOT NULL,
	`local_location_id` text,
	`selected_by_user_id` text NOT NULL,
	`selected_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`local_location_id`) REFERENCES `organization_locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`selected_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "marketing_resource_selections_provider_check" CHECK("marketing_resource_selections"."provider" in ('google','meta')),
	CONSTRAINT "marketing_resource_selections_dataset_check" CHECK("marketing_resource_selections"."dataset" in ('google_analytics','google_search_console','meta_ads')),
	CONSTRAINT "marketing_resource_selections_pair_check" CHECK((("marketing_resource_selections"."provider" = 'google' and "marketing_resource_selections"."dataset" in ('google_analytics','google_search_console')) or ("marketing_resource_selections"."provider" = 'meta' and "marketing_resource_selections"."dataset" = 'meta_ads'))),
	CONSTRAINT "marketing_resource_selections_scope_check" CHECK((("marketing_resource_selections"."scope_kind" = 'organization' and "marketing_resource_selections"."local_location_id" is null) or ("marketing_resource_selections"."scope_kind" = 'location' and "marketing_resource_selections"."local_location_id" is not null)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `marketing_resource_selections_resource_unique` ON `marketing_resource_selections` (`organization_id`,`connection_id`,`dataset`,`external_resource_ref`);--> statement-breakpoint
CREATE INDEX `marketing_resource_selections_connection_idx` ON `marketing_resource_selections` (`organization_id`,`connection_id`);--> statement-breakpoint
CREATE INDEX `marketing_resource_selections_location_idx` ON `marketing_resource_selections` (`organization_id`,`local_location_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_marketing_daily_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_selection_id` text NOT NULL,
	`metric_date` text NOT NULL,
	`metric_key` text NOT NULL,
	`value_milli` integer NOT NULL,
	`source_event_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`resource_selection_id`) REFERENCES `marketing_resource_selections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "marketing_daily_metrics_value_check" CHECK("__new_marketing_daily_metrics"."value_milli" >= 0)
);
--> statement-breakpoint
DROP TABLE `marketing_daily_metrics`;--> statement-breakpoint
ALTER TABLE `__new_marketing_daily_metrics` RENAME TO `marketing_daily_metrics`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `marketing_daily_metrics_source_unique` ON `marketing_daily_metrics` (`resource_selection_id`,`source_event_id`);--> statement-breakpoint
CREATE INDEX `marketing_daily_metrics_selection_date_idx` ON `marketing_daily_metrics` (`resource_selection_id`,`metric_date`,`metric_key`);--> statement-breakpoint
ALTER TABLE `integration_connections` ADD `resource_selection_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `integration_sync_runs` ADD `resource_selection_version` integer;
