ALTER TABLE `integration_connections` ADD `sync_lease_owner` text;--> statement-breakpoint
ALTER TABLE `integration_connections` ADD `sync_lease_expires_at` integer;--> statement-breakpoint
ALTER TABLE `integration_connections` ADD `sync_version` integer DEFAULT 0 NOT NULL;