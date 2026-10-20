CREATE TABLE `bank_csv_void_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`import_id` text NOT NULL,
	`reason` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`) REFERENCES `bank_csv_imports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_csv_void_unique` ON `bank_csv_void_events` (`organization_id`,`import_id`);--> statement-breakpoint
DROP INDEX `bank_csv_source_unique`;--> statement-breakpoint
CREATE INDEX `bank_csv_digest_idx` ON `bank_csv_imports` (`organization_id`,`source_digest`);--> statement-breakpoint
CREATE UNIQUE INDEX `bank_csv_source_unique` ON `bank_csv_imports` (`organization_id`,`fingerprint`);--> statement-breakpoint
CREATE TRIGGER bank_csv_archive_validate BEFORE INSERT ON bank_csv_void_events
BEGIN
 SELECT RAISE(ABORT,'BANK_CSV_ARCHIVE_REVIEW') WHERE length(trim(NEW.reason))=0 OR NOT EXISTS(SELECT 1 FROM bank_csv_imports s WHERE s.id=NEW.import_id AND s.organization_id=NEW.organization_id AND s.status='approved') OR EXISTS(SELECT 1 FROM bank_csv_rows r LEFT JOIN financial_transactions t ON t.id=r.transaction_id WHERE r.import_id=NEW.import_id AND (t.id IS NULL OR t.organization_id<>NEW.organization_id OR t.journal_entry_id IS NOT NULL OR t.reconciliation_status<>'unreconciled' OR t.source_state<>'posted' OR EXISTS(SELECT 1 FROM bank_accounting_events e WHERE e.transaction_id=t.id) OR EXISTS(SELECT 1 FROM invoice_accounting_events e WHERE e.source_transaction_id=t.id) OR EXISTS(SELECT 1 FROM bank_reconciliation_lines c WHERE c.transaction_id=t.id)));
END;
--> statement-breakpoint
DROP TRIGGER bank_source_transaction_immutable;
--> statement-breakpoint
CREATE TRIGGER bank_source_transaction_immutable BEFORE UPDATE OF account_id,amount_cents,currency,posting_date,source_system,external_source_id,source_state,demo_record ON financial_transactions
WHEN (EXISTS(SELECT 1 FROM bank_csv_rows r WHERE r.transaction_id=OLD.id) OR OLD.journal_entry_id IS NOT NULL OR OLD.reconciliation_status='reconciled') AND (NEW.account_id IS NOT OLD.account_id OR NEW.amount_cents<>OLD.amount_cents OR NEW.currency<>OLD.currency OR NEW.posting_date<>OLD.posting_date OR NEW.demo_record<>OLD.demo_record OR (NEW.source_state<>OLD.source_state AND NOT(OLD.source_state='posted' AND NEW.source_state='removed' AND OLD.journal_entry_id IS NULL AND OLD.reconciliation_status='unreconciled' AND EXISTS(SELECT 1 FROM bank_csv_rows r JOIN bank_csv_void_events v ON v.import_id=r.import_id WHERE r.transaction_id=OLD.id AND v.organization_id=OLD.organization_id))) OR ((NEW.source_system<>OLD.source_system OR NEW.external_source_id<>OLD.external_source_id) AND NOT(OLD.source_system='plaid' AND NEW.source_system='retained_accounting' AND NEW.external_source_id='retained:'||OLD.id)))
BEGIN SELECT RAISE(ABORT,'BANK_SOURCE_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER bank_csv_archive_apply AFTER INSERT ON bank_csv_void_events
BEGIN UPDATE financial_transactions SET source_state='removed',updated_at=NEW.created_at WHERE organization_id=NEW.organization_id AND id IN(SELECT transaction_id FROM bank_csv_rows WHERE import_id=NEW.import_id); END;
--> statement-breakpoint
CREATE TRIGGER bank_csv_archive_immutable BEFORE UPDATE ON bank_csv_void_events BEGIN SELECT RAISE(ABORT,'BANK_CSV_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER bank_csv_archive_retained BEFORE DELETE ON bank_csv_void_events WHEN EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.organization_id) BEGIN SELECT RAISE(ABORT,'BANK_CSV_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER bank_csv_active_overlap BEFORE INSERT ON bank_csv_imports
BEGIN
 SELECT RAISE(ABORT,'BANK_CSV_OVERLAP') WHERE EXISTS(SELECT 1 FROM bank_csv_imports s WHERE s.organization_id=NEW.organization_id AND s.bank_account_id=NEW.bank_account_id AND s.start_date<=NEW.end_date AND s.end_date>=NEW.start_date AND NOT EXISTS(SELECT 1 FROM bank_csv_void_events v WHERE v.import_id=s.id AND v.organization_id=s.organization_id)) OR EXISTS(SELECT 1 FROM bank_statement_imports s WHERE s.organization_id=NEW.organization_id AND s.bank_account_id=NEW.bank_account_id AND s.start_date<=NEW.end_date AND s.end_date>=NEW.start_date);
END;
--> statement-breakpoint
DROP TRIGGER bank_csv_import_validate;
--> statement-breakpoint
CREATE TRIGGER bank_csv_import_validate BEFORE INSERT ON bank_csv_imports
BEGIN
 SELECT RAISE(ABORT,'BANK_CSV_ACCOUNT') WHERE NOT EXISTS(SELECT 1 FROM bank_accounts b JOIN financial_accounts a ON a.id=b.financial_account_id AND a.organization_id=b.organization_id JOIN bookloq_settings s ON s.organization_id=b.organization_id WHERE b.id=NEW.bank_account_id AND b.organization_id=NEW.organization_id AND b.financial_account_id=NEW.financial_account_id AND b.currency=NEW.currency AND b.provider='manual' AND b.connection_status='manual' AND b.demo_record=0 AND a.active=1 AND a.account_type='asset' AND a.normal_balance='debit' AND a.account_subtype IN ('cash','bank') AND s.status='active' AND s.data_mode='live' AND s.base_currency=NEW.currency);
 SELECT RAISE(ABORT,'BANK_CSV_ACTIVE_SOURCE') WHERE EXISTS(SELECT 1 FROM bank_csv_imports s WHERE s.organization_id=NEW.organization_id AND s.source_digest=NEW.source_digest AND NOT EXISTS(SELECT 1 FROM bank_csv_void_events v WHERE v.import_id=s.id AND v.organization_id=s.organization_id));
END;
--> statement-breakpoint
DROP TRIGGER bank_statement_csv_overlap;
--> statement-breakpoint
CREATE TRIGGER bank_statement_csv_overlap BEFORE INSERT ON bank_statement_imports
BEGIN SELECT RAISE(ABORT,'STATEMENT_PERIOD_OVERLAP') WHERE EXISTS(SELECT 1 FROM bank_csv_imports s WHERE s.organization_id=NEW.organization_id AND s.bank_account_id=NEW.bank_account_id AND s.start_date<=NEW.end_date AND s.end_date>=NEW.start_date AND NOT EXISTS(SELECT 1 FROM bank_csv_void_events v WHERE v.import_id=s.id AND v.organization_id=s.organization_id)); END;
--> statement-breakpoint
-- Re-evaluate continuity after any competing completion. A review cannot silently
-- reset its opening basis when a prior reconciliation was completed meanwhile.
CREATE TRIGGER bank_reconciliation_continuity BEFORE UPDATE OF status ON bank_reconciliation_runs WHEN NEW.status='completed'
BEGIN
 SELECT RAISE(ABORT,'BANK_RECONCILIATION_CONTINUITY') WHERE NEW.baseline_date<>COALESCE((SELECT prior.baseline_date FROM bank_reconciliation_runs prior JOIN reconciliations q ON q.id=prior.reconciliation_id WHERE prior.organization_id=NEW.organization_id AND prior.account_id=NEW.account_id AND prior.status='completed' AND q.end_date<(SELECT start_date FROM reconciliations WHERE id=NEW.reconciliation_id) ORDER BY q.end_date DESC LIMIT 1),(SELECT start_date FROM reconciliations WHERE id=NEW.reconciliation_id)) OR EXISTS(SELECT 1 FROM bank_reconciliation_runs prior JOIN reconciliations q ON q.id=prior.reconciliation_id WHERE prior.organization_id=NEW.organization_id AND prior.account_id=NEW.account_id AND prior.status='completed' AND q.end_date>=(SELECT start_date FROM reconciliations WHERE id=NEW.reconciliation_id));
END;
--> statement-breakpoint
CREATE TRIGGER accounted_journal_header_immutable BEFORE UPDATE OF entry_date,posting_date,period_id,currency,total_debit_cents,total_credit_cents,source_type,source_ref,reversal_of_entry_id ON journal_entries
WHEN (EXISTS(SELECT 1 FROM invoice_accounting_events e WHERE e.journal_entry_id=OLD.id) OR EXISTS(SELECT 1 FROM bank_accounting_events e WHERE e.journal_entry_id=OLD.id) OR EXISTS(SELECT 1 FROM bank_reconciliation_lines r JOIN journal_lines l ON l.id=r.cash_line_id WHERE l.journal_entry_id=OLD.id AND r.active=1)) AND (NEW.entry_date<>OLD.entry_date OR NEW.posting_date<>OLD.posting_date OR NEW.period_id IS NOT OLD.period_id OR NEW.currency<>OLD.currency OR NEW.total_debit_cents<>OLD.total_debit_cents OR NEW.total_credit_cents<>OLD.total_credit_cents OR NEW.source_type<>OLD.source_type OR NEW.source_ref IS NOT OLD.source_ref OR NEW.reversal_of_entry_id IS NOT OLD.reversal_of_entry_id)
BEGIN SELECT RAISE(ABORT,'BANK_JOURNAL_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER accounted_journal_status_immutable BEFORE UPDATE OF status ON journal_entries
WHEN NEW.status<>OLD.status AND (EXISTS(SELECT 1 FROM invoice_accounting_events e WHERE e.journal_entry_id=OLD.id) OR EXISTS(SELECT 1 FROM bank_accounting_events e WHERE e.journal_entry_id=OLD.id AND e.event_type IN ('post','reverse')) OR EXISTS(SELECT 1 FROM bank_reconciliation_lines r JOIN journal_lines l ON l.id=r.cash_line_id WHERE l.journal_entry_id=OLD.id AND r.active=1)) AND NOT(NEW.status='reversed' AND (EXISTS(SELECT 1 FROM invoice_accounting_events e JOIN invoice_accounting_events original ON original.id=e.reversal_of_event_id WHERE original.journal_entry_id=OLD.id AND e.event_type IN ('reverse_payment','void')) OR EXISTS(SELECT 1 FROM bank_accounting_events e JOIN bank_accounting_events original ON original.id=e.reversal_of_event_id WHERE original.journal_entry_id=OLD.id AND e.event_type='reverse')))
BEGIN SELECT RAISE(ABORT,'BANK_JOURNAL_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER imported_bank_period_close BEFORE UPDATE OF status ON accounting_periods WHEN NEW.status='locked' AND OLD.status IN ('open','review')
BEGIN SELECT RAISE(ABORT,'BANK_CLOSE_REVIEW_REQUIRED') WHERE EXISTS(SELECT 1 FROM financial_transactions t WHERE t.organization_id=NEW.organization_id AND t.demo_record=0 AND t.source_state='posted' AND t.source_system IN ('bank_csv','bank_statement') AND t.posting_date BETWEEN NEW.start_date AND NEW.end_date AND (t.journal_entry_id IS NULL OR t.reconciliation_status<>'reconciled')); END;
