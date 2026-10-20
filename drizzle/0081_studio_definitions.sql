CREATE TABLE `studio_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`app` text NOT NULL,
	`scope_json` text NOT NULL,
	`content_json` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "studio_definition_app_check" CHECK("studio_definitions"."app" IN ('dashboards','sheets','sql')),
	CONSTRAINT "studio_definition_title_check" CHECK(length("studio_definitions"."title") BETWEEN 1 AND 100),
	CONSTRAINT "studio_definition_scope_check" CHECK(json_valid("studio_definitions"."scope_json") AND length(CAST("studio_definitions"."scope_json" AS BLOB))<=2048),
	CONSTRAINT "studio_definition_content_check" CHECK(json_valid("studio_definitions"."content_json") AND length(CAST("studio_definitions"."content_json" AS BLOB))<=16384),
	CONSTRAINT "studio_definition_version_check" CHECK("studio_definitions"."version">=1 AND "studio_definitions"."version"<9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `studio_definitions_owner_updated_idx` ON `studio_definitions` (`organization_id`,`user_id`,`updated_at`,`id`);