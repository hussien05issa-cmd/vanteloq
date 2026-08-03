CREATE TABLE `accounting_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`label` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`locked_at` integer,
	`locked_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`locked_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "accounting_periods_status_check" CHECK("accounting_periods"."status" in ('open', 'review', 'locked')),
	CONSTRAINT "accounting_periods_dates_check" CHECK("accounting_periods"."start_date" <= "accounting_periods"."end_date")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounting_periods_workspace_dates_unique` ON `accounting_periods` (`organization_id`,`start_date`,`end_date`);--> statement-breakpoint
CREATE INDEX `accounting_periods_workspace_status_idx` ON `accounting_periods` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`financial_account_id` text NOT NULL,
	`name` text NOT NULL,
	`account_type` text NOT NULL,
	`institution_name` text NOT NULL,
	`masked_number` text NOT NULL,
	`live_balance_cents` integer,
	`available_balance_cents` integer,
	`book_balance_cents` integer DEFAULT 0 NOT NULL,
	`available_credit_cents` integer,
	`connection_status` text DEFAULT 'manual' NOT NULL,
	`last_sync_at` integer,
	`last_reconciled_at` integer,
	`demo_record` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`financial_account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bank_accounts_type_check" CHECK("bank_accounts"."account_type" in ('chequing', 'savings', 'credit_card', 'line_of_credit', 'merchant', 'loan')),
	CONSTRAINT "bank_accounts_connection_check" CHECK("bank_accounts"."connection_status" in ('manual', 'healthy', 'delayed', 'error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_accounts_workspace_ledger_unique` ON `bank_accounts` (`organization_id`,`financial_account_id`);--> statement-breakpoint
CREATE TABLE `bookloq_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`severity` text NOT NULL,
	`alert_type` text NOT NULL,
	`title` text NOT NULL,
	`explanation` text NOT NULL,
	`dollar_impact_cents` integer,
	`confidence` text NOT NULL,
	`supporting_records_json` text DEFAULT '[]' NOT NULL,
	`recommended_action` text NOT NULL,
	`assigned_user_id` text,
	`due_date` text,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution_history_json` text DEFAULT '[]' NOT NULL,
	`demo_record` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bookloq_alerts_severity_check" CHECK("bookloq_alerts"."severity" in ('critical', 'attention', 'opportunity', 'informational')),
	CONSTRAINT "bookloq_alerts_confidence_check" CHECK("bookloq_alerts"."confidence" in ('high', 'medium', 'low')),
	CONSTRAINT "bookloq_alerts_status_check" CHECK("bookloq_alerts"."status" in ('open', 'in_progress', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE INDEX `bookloq_alerts_workspace_status_idx` ON `bookloq_alerts` (`organization_id`,`status`,`severity`);--> statement-breakpoint
CREATE TABLE `bookloq_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`account_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`location_ref` text DEFAULT 'all' NOT NULL,
	`department_ref` text DEFAULT 'all' NOT NULL,
	`budget_cents` integer NOT NULL,
	`committed_cents` integer DEFAULT 0 NOT NULL,
	`forecast_cents` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bookloq_budgets_amount_check" CHECK("bookloq_budgets"."budget_cents" >= 0 and "bookloq_budgets"."committed_cents" >= 0 and "bookloq_budgets"."forecast_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookloq_budgets_scope_unique` ON `bookloq_budgets` (`organization_id`,`account_id`,`period_start`,`period_end`,`location_ref`,`department_ref`);--> statement-breakpoint
CREATE TABLE `bookloq_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`contact_type` text NOT NULL,
	`name` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`billing_address` text DEFAULT '' NOT NULL,
	`payment_terms_days` integer DEFAULT 30 NOT NULL,
	`credit_limit_cents` integer DEFAULT 0 NOT NULL,
	`tax_registration_number` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "bookloq_contacts_type_check" CHECK("bookloq_contacts"."contact_type" in ('customer', 'supplier', 'both')),
	CONSTRAINT "bookloq_contacts_terms_check" CHECK("bookloq_contacts"."payment_terms_days" between 0 and 365),
	CONSTRAINT "bookloq_contacts_credit_check" CHECK("bookloq_contacts"."credit_limit_cents" >= 0)
);
--> statement-breakpoint
CREATE INDEX `bookloq_contacts_workspace_type_idx` ON `bookloq_contacts` (`organization_id`,`contact_type`);--> statement-breakpoint
CREATE TABLE `bookloq_role_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`permissions_json` text DEFAULT '[]' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bookloq_roles_role_check" CHECK("bookloq_role_assignments"."role" in ('owner', 'administrator', 'finance_manager', 'store_manager', 'accountant', 'bookkeeper', 'ap_clerk', 'ar_clerk', 'employee', 'read_only_auditor'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookloq_roles_workspace_user_unique` ON `bookloq_role_assignments` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `bookloq_roles_workspace_role_idx` ON `bookloq_role_assignments` (`organization_id`,`role`);--> statement-breakpoint
CREATE TABLE `bookloq_settings` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`base_currency` text DEFAULT 'CAD' NOT NULL,
	`country_code` text DEFAULT 'CA' NOT NULL,
	`province_code` text DEFAULT 'AB' NOT NULL,
	`accounting_basis` text DEFAULT 'accrual' NOT NULL,
	`fiscal_year_start_month` integer DEFAULT 1 NOT NULL,
	`cash_safety_threshold_cents` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'not_configured' NOT NULL,
	`data_mode` text DEFAULT 'live' NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bookloq_settings_basis_check" CHECK("bookloq_settings"."accounting_basis" in ('accrual', 'cash')),
	CONSTRAINT "bookloq_settings_status_check" CHECK("bookloq_settings"."status" in ('not_configured', 'active', 'suspended')),
	CONSTRAINT "bookloq_settings_mode_check" CHECK("bookloq_settings"."data_mode" in ('live', 'demonstration')),
	CONSTRAINT "bookloq_settings_fiscal_month_check" CHECK("bookloq_settings"."fiscal_year_start_month" between 1 and 12),
	CONSTRAINT "bookloq_settings_threshold_check" CHECK("bookloq_settings"."cash_safety_threshold_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE `customer_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`invoice_number` text NOT NULL,
	`invoice_date` text NOT NULL,
	`due_date` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer NOT NULL,
	`paid_cents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`location_ref` text DEFAULT 'all' NOT NULL,
	`journal_entry_id` text,
	`demo_record` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `bookloq_contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "customer_invoices_amount_check" CHECK("customer_invoices"."subtotal_cents" >= 0 and "customer_invoices"."tax_cents" >= 0 and "customer_invoices"."total_cents" = "customer_invoices"."subtotal_cents" + "customer_invoices"."tax_cents" and "customer_invoices"."paid_cents" >= 0 and "customer_invoices"."paid_cents" <= "customer_invoices"."total_cents")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_invoices_workspace_number_unique` ON `customer_invoices` (`organization_id`,`invoice_number`);--> statement-breakpoint
CREATE INDEX `customer_invoices_workspace_due_idx` ON `customer_invoices` (`organization_id`,`due_date`,`status`);--> statement-breakpoint
CREATE TABLE `financial_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`account_type` text NOT NULL,
	`account_subtype` text NOT NULL,
	`normal_balance` text NOT NULL,
	`system_key` text,
	`parent_account_id` text,
	`description` text DEFAULT '' NOT NULL,
	`plain_language` text DEFAULT '' NOT NULL,
	`tax_treatment` text DEFAULT 'none' NOT NULL,
	`restricted` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "financial_accounts_type_check" CHECK("financial_accounts"."account_type" in ('asset', 'liability', 'equity', 'revenue', 'expense')),
	CONSTRAINT "financial_accounts_normal_balance_check" CHECK("financial_accounts"."normal_balance" in ('debit', 'credit'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_accounts_workspace_code_unique` ON `financial_accounts` (`organization_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `financial_accounts_workspace_system_unique` ON `financial_accounts` (`organization_id`,`system_key`);--> statement-breakpoint
CREATE INDEX `financial_accounts_workspace_type_idx` ON `financial_accounts` (`organization_id`,`account_type`);--> statement-breakpoint
CREATE TABLE `financial_transactions` (
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
	CONSTRAINT "financial_transactions_reconciliation_check" CHECK("financial_transactions"."reconciliation_status" in ('unreconciled', 'matched', 'reconciled')),
	CONSTRAINT "financial_transactions_categorization_check" CHECK("financial_transactions"."categorization_status" in ('confirmed', 'suggested', 'missing', 'issue', 'accountant_review')),
	CONSTRAINT "financial_transactions_confidence_check" CHECK("financial_transactions"."confidence_basis_points" between 0 and 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_transactions_source_unique` ON `financial_transactions` (`organization_id`,`source_system`,`external_source_id`);--> statement-breakpoint
CREATE INDEX `financial_transactions_workspace_date_idx` ON `financial_transactions` (`organization_id`,`posting_date`);--> statement-breakpoint
CREATE INDEX `financial_transactions_workspace_review_idx` ON `financial_transactions` (`organization_id`,`categorization_status`,`reconciliation_status`);--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`entry_number` text NOT NULL,
	`entry_date` text NOT NULL,
	`posting_date` text NOT NULL,
	`period_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`source_type` text DEFAULT 'manual' NOT NULL,
	`source_ref` text,
	`memo` text NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`exchange_rate_ppm` integer DEFAULT 1000000 NOT NULL,
	`total_debit_cents` integer NOT NULL,
	`total_credit_cents` integer NOT NULL,
	`reversal_of_entry_id` text,
	`idempotency_key` text NOT NULL,
	`prepared_by_user_id` text NOT NULL,
	`approved_by_user_id` text,
	`posted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`period_id`) REFERENCES `accounting_periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prepared_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "journal_entries_status_check" CHECK("journal_entries"."status" in ('draft', 'posted', 'reversed', 'void')),
	CONSTRAINT "journal_entries_money_check" CHECK("journal_entries"."total_debit_cents" >= 0 and "journal_entries"."total_credit_cents" >= 0),
	CONSTRAINT "journal_entries_balance_check" CHECK("journal_entries"."status" != 'posted' or "journal_entries"."total_debit_cents" = "journal_entries"."total_credit_cents"),
	CONSTRAINT "journal_entries_rate_check" CHECK("journal_entries"."exchange_rate_ppm" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `journal_entries_workspace_number_unique` ON `journal_entries` (`organization_id`,`entry_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `journal_entries_workspace_idempotency_unique` ON `journal_entries` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `journal_entries_workspace_reversal_unique` ON `journal_entries` (`organization_id`,`reversal_of_entry_id`);--> statement-breakpoint
CREATE INDEX `journal_entries_workspace_date_idx` ON `journal_entries` (`organization_id`,`posting_date`);--> statement-breakpoint
CREATE INDEX `journal_entries_workspace_status_idx` ON `journal_entries` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `journal_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`journal_entry_id` text NOT NULL,
	`line_number` integer NOT NULL,
	`account_id` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`debit_cents` integer DEFAULT 0 NOT NULL,
	`credit_cents` integer DEFAULT 0 NOT NULL,
	`tax_code` text,
	`tax_amount_cents` integer DEFAULT 0 NOT NULL,
	`contact_id` text,
	`location_ref` text DEFAULT 'all' NOT NULL,
	`department_ref` text,
	`project_ref` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `bookloq_contacts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "journal_lines_amount_check" CHECK("journal_lines"."debit_cents" >= 0 and "journal_lines"."credit_cents" >= 0 and (("journal_lines"."debit_cents" > 0 and "journal_lines"."credit_cents" = 0) or ("journal_lines"."credit_cents" > 0 and "journal_lines"."debit_cents" = 0))),
	CONSTRAINT "journal_lines_tax_check" CHECK("journal_lines"."tax_amount_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `journal_lines_entry_line_unique` ON `journal_lines` (`journal_entry_id`,`line_number`);--> statement-breakpoint
CREATE INDEX `journal_lines_workspace_account_idx` ON `journal_lines` (`organization_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `month_end_items` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`period_id` text NOT NULL,
	`item_key` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`assigned_user_id` text,
	`due_date` text,
	`blocker` text DEFAULT '' NOT NULL,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`period_id`) REFERENCES `accounting_periods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "month_end_items_status_check" CHECK("month_end_items"."status" in ('not_started', 'in_progress', 'blocked', 'complete'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `month_end_items_period_key_unique` ON `month_end_items` (`period_id`,`item_key`);--> statement-breakpoint
CREATE INDEX `month_end_items_workspace_status_idx` ON `month_end_items` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `reconciliations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`account_id` text NOT NULL,
	`reconciliation_type` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`opening_balance_cents` integer NOT NULL,
	`closing_balance_cents` integer NOT NULL,
	`book_balance_cents` integer NOT NULL,
	`difference_cents` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`prepared_by_user_id` text,
	`reviewed_by_user_id` text,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prepared_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reconciliations_status_check" CHECK("reconciliations"."status" in ('draft', 'prepared', 'reviewed', 'completed', 'locked')),
	CONSTRAINT "reconciliations_dates_check" CHECK("reconciliations"."start_date" <= "reconciliations"."end_date")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reconciliations_workspace_account_period_unique` ON `reconciliations` (`organization_id`,`account_id`,`start_date`,`end_date`);--> statement-breakpoint
CREATE INDEX `reconciliations_workspace_status_idx` ON `reconciliations` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `supplier_bills` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`bill_number` text NOT NULL,
	`invoice_date` text NOT NULL,
	`due_date` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer NOT NULL,
	`paid_cents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`purchase_order_ref` text,
	`location_ref` text DEFAULT 'all' NOT NULL,
	`approval_status` text DEFAULT 'pending' NOT NULL,
	`journal_entry_id` text,
	`demo_record` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supplier_id`) REFERENCES `bookloq_contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "supplier_bills_amount_check" CHECK("supplier_bills"."subtotal_cents" >= 0 and "supplier_bills"."tax_cents" >= 0 and "supplier_bills"."total_cents" = "supplier_bills"."subtotal_cents" + "supplier_bills"."tax_cents" and "supplier_bills"."paid_cents" >= 0 and "supplier_bills"."paid_cents" <= "supplier_bills"."total_cents")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_bills_workspace_number_unique` ON `supplier_bills` (`organization_id`,`supplier_id`,`bill_number`);--> statement-breakpoint
CREATE INDEX `supplier_bills_workspace_due_idx` ON `supplier_bills` (`organization_id`,`due_date`,`status`);