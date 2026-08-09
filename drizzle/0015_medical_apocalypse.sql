CREATE TABLE `integration_staged_financial_records` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_record_id` text NOT NULL,
	`record_type` text NOT NULL,
	`category` text NOT NULL,
	`source_ref` text,
	`occurred_at` text NOT NULL,
	`available_at` text,
	`currency` text NOT NULL,
	`gross_cents` integer NOT NULL,
	`fee_cents` integer DEFAULT 0 NOT NULL,
	`net_cents` integer NOT NULL,
	`state` text NOT NULL,
	`livemode` integer DEFAULT false NOT NULL,
	`source_payload_hash` text NOT NULL,
	`sync_run_id` text NOT NULL,
	`staged_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sync_run_id`) REFERENCES `integration_sync_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "integration_staged_financial_type_check" CHECK("integration_staged_financial_records"."record_type" in ('balance_transaction', 'payout')),
	CONSTRAINT "integration_staged_financial_currency_check" CHECK(length("integration_staged_financial_records"."currency") = 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_staged_financial_record_unique` ON `integration_staged_financial_records` (`organization_id`,`provider`,`external_record_id`,`source_payload_hash`);--> statement-breakpoint
CREATE INDEX `integration_staged_financial_date_idx` ON `integration_staged_financial_records` (`organization_id`,`provider`,`record_type`,`occurred_at`);