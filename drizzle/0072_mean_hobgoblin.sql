CREATE TABLE `foodservice_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`version` integer NOT NULL,
	`content_json` text NOT NULL,
	`recorded_by` text,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `foodservice_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "foodservice_revision_json" CHECK(json_valid("foodservice_revisions"."content_json")),
	CONSTRAINT "foodservice_revision_positive" CHECK("foodservice_revisions"."version">0)
);
--> statement-breakpoint
CREATE INDEX `foodservice_revision_scope` ON `foodservice_revisions` (`organization_id`,`record_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `foodservice_revision_record_version` ON `foodservice_revisions` (`record_id`,`version`);