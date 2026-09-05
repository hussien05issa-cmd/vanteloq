CREATE TABLE `account_deletion_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`account_hash` text NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`token_hash` text NOT NULL,
	`plan_encrypted` text NOT NULL,
	`stage` text NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT "account_deletion_jobs_scope_check" CHECK("account_deletion_jobs"."scope" in ('account','workspace')),
	CONSTRAINT "account_deletion_jobs_stage_check" CHECK("account_deletion_jobs"."stage" in ('checking','confirmed','local_deleted','completed'))
);
--> statement-breakpoint
CREATE INDEX `account_deletion_jobs_user_idx` ON `account_deletion_jobs` (`user_id`,`stage`);--> statement-breakpoint
CREATE INDEX `account_deletion_jobs_org_idx` ON `account_deletion_jobs` (`organization_id`,`stage`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_deletion_jobs_account_unique` ON `account_deletion_jobs` (`account_hash`);