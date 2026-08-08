DELETE FROM `journal_lines` WHERE `organization_id` IN (SELECT `organization_id` FROM `bookloq_settings` WHERE `data_mode` = 'demonstration');
--> statement-breakpoint
DELETE FROM `financial_transactions` WHERE `organization_id` IN (SELECT `organization_id` FROM `bookloq_settings` WHERE `data_mode` = 'demonstration');
--> statement-breakpoint
DELETE FROM `bank_accounts` WHERE `organization_id` IN (SELECT `organization_id` FROM `bookloq_settings` WHERE `data_mode` = 'demonstration');
--> statement-breakpoint
DELETE FROM `reconciliations` WHERE `organization_id` IN (SELECT `organization_id` FROM `bookloq_settings` WHERE `data_mode` = 'demonstration');
--> statement-breakpoint
DELETE FROM `supplier_bills` WHERE `organization_id` IN (SELECT `organization_id` FROM `bookloq_settings` WHERE `data_mode` = 'demonstration');
--> statement-breakpoint
DELETE FROM `customer_invoices` WHERE `organization_id` IN (SELECT `organization_id` FROM `bookloq_settings` WHERE `data_mode` = 'demonstration');
--> statement-breakpoint
DELETE FROM `bookloq_alerts` WHERE `organization_id` IN (SELECT `organization_id` FROM `bookloq_settings` WHERE `data_mode` = 'demonstration');
--> statement-breakpoint
DELETE FROM `bookloq_budgets` WHERE `organization_id` IN (SELECT `organization_id` FROM `bookloq_settings` WHERE `data_mode` = 'demonstration');
--> statement-breakpoint
DELETE FROM `month_end_items` WHERE `organization_id` IN (SELECT `organization_id` FROM `bookloq_settings` WHERE `data_mode` = 'demonstration');
--> statement-breakpoint
DELETE FROM `journal_entries` WHERE `organization_id` IN (SELECT `organization_id` FROM `bookloq_settings` WHERE `data_mode` = 'demonstration');
--> statement-breakpoint
DELETE FROM `bookloq_contacts` WHERE `organization_id` IN (SELECT `organization_id` FROM `bookloq_settings` WHERE `data_mode` = 'demonstration');
--> statement-breakpoint
DELETE FROM `accounting_periods` WHERE `organization_id` IN (SELECT `organization_id` FROM `bookloq_settings` WHERE `data_mode` = 'demonstration');
--> statement-breakpoint
DELETE FROM `bookloq_role_assignments` WHERE `organization_id` IN (SELECT `organization_id` FROM `bookloq_settings` WHERE `data_mode` = 'demonstration');
--> statement-breakpoint
DELETE FROM `financial_accounts` WHERE `organization_id` IN (SELECT `organization_id` FROM `bookloq_settings` WHERE `data_mode` = 'demonstration');
--> statement-breakpoint
DELETE FROM `bookloq_settings` WHERE `data_mode` = 'demonstration';
