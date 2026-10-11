CREATE TABLE `free_integration_selections` (
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`grant_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `provider`),
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `free_integration_grant_unique` ON `free_integration_selections` (`grant_id`);--> statement-breakpoint
ALTER TABLE `integration_connections` ADD `free_grant_id` text;