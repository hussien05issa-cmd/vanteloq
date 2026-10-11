CREATE TABLE `foodservice_records` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`kind` text NOT NULL,
	`record_key` text NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`source_label` text NOT NULL,
	`as_of_date` text NOT NULL,
	`period_from` text DEFAULT '' NOT NULL,
	`period_to` text DEFAULT '' NOT NULL,
	`payload_json` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `organization_locations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "foodservice_kind" CHECK("foodservice_records"."kind" IN ('recipe','period')),
	CONSTRAINT "foodservice_name" CHECK(length("foodservice_records"."name") BETWEEN 1 AND 120),
	CONSTRAINT "foodservice_currency" CHECK(length("foodservice_records"."currency")=3),
	CONSTRAINT "foodservice_source" CHECK(length("foodservice_records"."source_label") BETWEEN 1 AND 120),
	CONSTRAINT "foodservice_json" CHECK(json_valid("foodservice_records"."payload_json")),
	CONSTRAINT "foodservice_version" CHECK("foodservice_records"."version">0)
);
--> statement-breakpoint
CREATE INDEX `foodservice_records_scope` ON `foodservice_records` (`organization_id`,`location_id`,`kind`,`updated_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `foodservice_records_scope_key` ON `foodservice_records` (`organization_id`,`location_id`,`kind`,`record_key`);
--> statement-breakpoint
CREATE TRIGGER foodservice_location_insert BEFORE INSERT ON foodservice_records
WHEN NOT EXISTS (SELECT 1 FROM organization_locations WHERE id=NEW.location_id AND organization_id=NEW.organization_id AND currency=NEW.currency)
BEGIN SELECT RAISE(ABORT,'foodservice location or currency mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER foodservice_location_update BEFORE UPDATE OF location_id,organization_id,currency ON foodservice_records
WHEN NOT EXISTS (SELECT 1 FROM organization_locations WHERE id=NEW.location_id AND organization_id=NEW.organization_id AND currency=NEW.currency)
BEGIN SELECT RAISE(ABORT,'foodservice location or currency mismatch'); END;
