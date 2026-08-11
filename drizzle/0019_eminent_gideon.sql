CREATE TABLE `commerce_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_payment_id` text NOT NULL,
	`external_sale_id` text NOT NULL,
	`payment_type_ref` text,
	`payment_type_name` text DEFAULT 'Other' NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`amount_cents` integer NOT NULL,
	`paid_at` text,
	`outlet_ref` text,
	`source_payload_hash` text NOT NULL,
	`sync_run_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sync_run_id`) REFERENCES `integration_sync_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "commerce_payments_category_check" CHECK("commerce_payments"."category" in ('cash','card','gift_card','store_credit','other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_payments_external_unique` ON `commerce_payments` (`organization_id`,`provider`,`external_payment_id`);--> statement-breakpoint
CREATE INDEX `commerce_payments_sale_idx` ON `commerce_payments` (`organization_id`,`provider`,`external_sale_id`);--> statement-breakpoint
CREATE INDEX `commerce_payments_date_idx` ON `commerce_payments` (`organization_id`,`provider`,`paid_at`);