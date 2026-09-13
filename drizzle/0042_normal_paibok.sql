CREATE TABLE `retail_measurements` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`provider` text NOT NULL,
	`outlet_ref` text NOT NULL,
	`kind` text NOT NULL,
	`reference` text NOT NULL,
	`period_from` text NOT NULL,
	`period_to` text NOT NULL,
	`source_label` text NOT NULL,
	`values_json` text NOT NULL,
	`updated_by_user_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "retail_measurements_kind_check" CHECK("retail_measurements"."kind" in ('stock','labour','loyalty','catalog')),
	CONSTRAINT "retail_measurements_json_check" CHECK(json_valid("retail_measurements"."values_json")),
	CONSTRAINT "retail_measurements_version_check" CHECK("retail_measurements"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retail_measurements_identity_unique` ON `retail_measurements` (`organization_id`,`connection_id`,`outlet_ref`,`kind`,`reference`,`period_from`,`period_to`);--> statement-breakpoint
CREATE INDEX `retail_measurements_scope_idx` ON `retail_measurements` (`organization_id`,`connection_id`,`kind`,`period_from`,`period_to`);