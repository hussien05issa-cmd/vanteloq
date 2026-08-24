CREATE TABLE `account_deletion_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_hash` text NOT NULL,
	`organization_hash` text NOT NULL,
	`scope` text NOT NULL,
	`result` text NOT NULL,
	`retained_categories_json` text DEFAULT '[]' NOT NULL,
	`provider_outcomes_json` text DEFAULT '{}' NOT NULL,
	`completed_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT "account_deletion_receipts_scope_check" CHECK("account_deletion_receipts"."scope" in ('account','workspace')),
	CONSTRAINT "account_deletion_receipts_result_check" CHECK("account_deletion_receipts"."result" in ('completed','auth_cleanup_pending'))
);
--> statement-breakpoint
CREATE INDEX `account_deletion_receipts_expiry_idx` ON `account_deletion_receipts` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `account_deletion_receipts_account_idx` ON `account_deletion_receipts` (`account_hash`,`completed_at`);
