PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_marketing_resource_selections` (
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
	CONSTRAINT "marketing_resource_selections_provider_check" CHECK("__new_marketing_resource_selections"."provider" in ('google','meta')),
	CONSTRAINT "marketing_resource_selections_dataset_check" CHECK("__new_marketing_resource_selections"."dataset" in ('google_analytics','google_search_console','google_business_profile','google_ads','meta_ads')),
	CONSTRAINT "marketing_resource_selections_pair_check" CHECK((("__new_marketing_resource_selections"."provider" = 'google' and "__new_marketing_resource_selections"."dataset" in ('google_analytics','google_search_console','google_business_profile','google_ads')) or ("__new_marketing_resource_selections"."provider" = 'meta' and "__new_marketing_resource_selections"."dataset" = 'meta_ads'))),
	CONSTRAINT "marketing_resource_selections_scope_check" CHECK((("__new_marketing_resource_selections"."scope_kind" = 'organization' and "__new_marketing_resource_selections"."local_location_id" is null) or ("__new_marketing_resource_selections"."scope_kind" = 'location' and "__new_marketing_resource_selections"."local_location_id" is not null)))
);
--> statement-breakpoint
INSERT INTO `__new_marketing_resource_selections`("id", "organization_id", "connection_id", "provider", "dataset", "external_resource_ref", "external_resource_name", "scope_kind", "local_location_id", "selected_by_user_id", "selected_at", "created_at", "updated_at") SELECT "id", "organization_id", "connection_id", "provider", "dataset", "external_resource_ref", "external_resource_name", "scope_kind", "local_location_id", "selected_by_user_id", "selected_at", "created_at", "updated_at" FROM `marketing_resource_selections`;--> statement-breakpoint
DROP TABLE `marketing_resource_selections`;--> statement-breakpoint
ALTER TABLE `__new_marketing_resource_selections` RENAME TO `marketing_resource_selections`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `marketing_resource_selections_resource_unique` ON `marketing_resource_selections` (`organization_id`,`connection_id`,`dataset`,`external_resource_ref`);--> statement-breakpoint
CREATE INDEX `marketing_resource_selections_connection_idx` ON `marketing_resource_selections` (`organization_id`,`connection_id`);--> statement-breakpoint
CREATE INDEX `marketing_resource_selections_location_idx` ON `marketing_resource_selections` (`organization_id`,`local_location_id`);