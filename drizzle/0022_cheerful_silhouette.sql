ALTER TABLE `bank_accounts` ADD `currency` text DEFAULT 'CAD' NOT NULL;--> statement-breakpoint
ALTER TABLE `bank_accounts` ADD `provider` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `bank_accounts` ADD `external_account_ref` text;--> statement-breakpoint
ALTER TABLE `bank_accounts` ADD `external_item_ref` text;--> statement-breakpoint
CREATE UNIQUE INDEX `bank_accounts_provider_external_unique` ON `bank_accounts` (`organization_id`,`provider`,`external_account_ref`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_financial_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`transaction_date` text NOT NULL,
	`posting_date` text NOT NULL,
	`description` text NOT NULL,
	`original_description` text DEFAULT '' NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`exchange_rate_ppm` integer DEFAULT 1000000 NOT NULL,
	`tax_amount_cents` integer DEFAULT 0 NOT NULL,
	`account_id` text,
	`contact_id` text,
	`source_system` text NOT NULL,
	`external_source_id` text NOT NULL,
	`source_state` text DEFAULT 'posted' NOT NULL,
	`pending_external_source_id` text,
	`location_ref` text DEFAULT 'all' NOT NULL,
	`department_ref` text,
	`project_ref` text,
	`reconciliation_status` text DEFAULT 'unreconciled' NOT NULL,
	`categorization_status` text DEFAULT 'missing' NOT NULL,
	`confidence_basis_points` integer DEFAULT 0 NOT NULL,
	`approval_status` text DEFAULT 'not_required' NOT NULL,
	`journal_entry_id` text,
	`demo_record` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `bookloq_contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "financial_transactions_reconciliation_check" CHECK("__new_financial_transactions"."reconciliation_status" in ('unreconciled', 'matched', 'reconciled')),
	CONSTRAINT "financial_transactions_categorization_check" CHECK("__new_financial_transactions"."categorization_status" in ('confirmed', 'suggested', 'missing', 'issue', 'accountant_review')),
	CONSTRAINT "financial_transactions_confidence_check" CHECK("__new_financial_transactions"."confidence_basis_points" between 0 and 10000),
	CONSTRAINT "financial_transactions_source_state_check" CHECK("__new_financial_transactions"."source_state" in ('pending', 'posted', 'modified', 'removed'))
);
--> statement-breakpoint
INSERT INTO `__new_financial_transactions`("id", "organization_id", "transaction_date", "posting_date", "description", "original_description", "amount_cents", "currency", "exchange_rate_ppm", "tax_amount_cents", "account_id", "contact_id", "source_system", "external_source_id", "source_state", "pending_external_source_id", "location_ref", "department_ref", "project_ref", "reconciliation_status", "categorization_status", "confidence_basis_points", "approval_status", "journal_entry_id", "demo_record", "created_at", "updated_at") SELECT "id", "organization_id", "transaction_date", "posting_date", "description", "original_description", "amount_cents", "currency", "exchange_rate_ppm", "tax_amount_cents", "account_id", "contact_id", "source_system", "external_source_id", 'posted', NULL, "location_ref", "department_ref", "project_ref", "reconciliation_status", "categorization_status", "confidence_basis_points", "approval_status", "journal_entry_id", "demo_record", "created_at", "updated_at" FROM `financial_transactions`;--> statement-breakpoint
DROP TABLE `financial_transactions`;--> statement-breakpoint
ALTER TABLE `__new_financial_transactions` RENAME TO `financial_transactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `financial_transactions_source_unique` ON `financial_transactions` (`organization_id`,`source_system`,`external_source_id`);--> statement-breakpoint
CREATE INDEX `financial_transactions_workspace_date_idx` ON `financial_transactions` (`organization_id`,`posting_date`);--> statement-breakpoint
CREATE INDEX `financial_transactions_workspace_review_idx` ON `financial_transactions` (`organization_id`,`categorization_status`,`reconciliation_status`);
