CREATE TABLE `stripe_billing_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`event_type` text NOT NULL,
	`stripe_created_at` integer NOT NULL,
	`payload_hash` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`error_code` text,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "stripe_billing_events_status_check" CHECK("stripe_billing_events"."status" in ('received','processing','processed','failed','ignored'))
);
--> statement-breakpoint
CREATE INDEX `stripe_billing_events_workspace_created_idx` ON `stripe_billing_events` (`organization_id`,`stripe_created_at`);--> statement-breakpoint
CREATE INDEX `stripe_billing_events_status_idx` ON `stripe_billing_events` (`status`,`received_at`);