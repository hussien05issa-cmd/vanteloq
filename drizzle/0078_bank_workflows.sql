CREATE TABLE `bank_accounting_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`event_type` text NOT NULL,
	`event_date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`cash_account_id` text NOT NULL,
	`journal_entry_id` text NOT NULL,
	`cash_line_id` text NOT NULL,
	`reversal_of_event_id` text,
	`counter_account_id` text,
	`reason` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_json` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `financial_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_line_id`) REFERENCES `journal_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`counter_account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bank_accounting_type" CHECK("bank_accounting_events"."event_type" IN ('post','match','reverse','unmatch'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_accounting_request_unique` ON `bank_accounting_events` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `bank_accounting_reversal_unique` ON `bank_accounting_events` (`organization_id`,`reversal_of_event_id`);--> statement-breakpoint
CREATE INDEX `bank_accounting_transaction_idx` ON `bank_accounting_events` (`organization_id`,`transaction_id`);--> statement-breakpoint
CREATE TABLE `bank_csv_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`bank_account_id` text NOT NULL,
	`financial_account_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`currency` text NOT NULL,
	`opening_balance_cents` integer NOT NULL,
	`closing_balance_cents` integer NOT NULL,
	`row_count` integer NOT NULL,
	`inflow_cents` integer NOT NULL,
	`outflow_cents` integer NOT NULL,
	`source_digest` text NOT NULL,
	`fingerprint` text NOT NULL,
	`file_name` text NOT NULL,
	`object_key` text NOT NULL,
	`mapping_json` text NOT NULL,
	`status` text NOT NULL,
	`approved_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`financial_account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bank_csv_balance" CHECK("bank_csv_imports"."opening_balance_cents"+"bank_csv_imports"."inflow_cents"-"bank_csv_imports"."outflow_cents"="bank_csv_imports"."closing_balance_cents"),
	CONSTRAINT "bank_csv_rows_count" CHECK("bank_csv_imports"."row_count" BETWEEN 1 AND 500),
	CONSTRAINT "bank_csv_status" CHECK("bank_csv_imports"."status" IN ('staging','approved'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_csv_source_unique` ON `bank_csv_imports` (`organization_id`,`source_digest`);--> statement-breakpoint
CREATE INDEX `bank_csv_period_idx` ON `bank_csv_imports` (`organization_id`,`bank_account_id`,`start_date`,`end_date`);--> statement-breakpoint
CREATE TABLE `bank_csv_rows` (
	`import_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`source_row_number` integer NOT NULL,
	PRIMARY KEY(`import_id`, `source_row_number`),
	FOREIGN KEY (`import_id`) REFERENCES `bank_csv_imports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `financial_transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_csv_transaction_unique` ON `bank_csv_rows` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `bank_reconciliation_lines` (
	`run_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`cash_line_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`run_id`, `transaction_id`),
	FOREIGN KEY (`run_id`) REFERENCES `bank_reconciliation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `financial_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_line_id`) REFERENCES `journal_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_reconciliation_cash_line_unique` ON `bank_reconciliation_lines` (`cash_line_id`) WHERE "bank_reconciliation_lines"."active"=1;--> statement-breakpoint
CREATE UNIQUE INDEX `bank_reconciliation_source_row_unique` ON `bank_reconciliation_lines` (`transaction_id`) WHERE "bank_reconciliation_lines"."active"=1;--> statement-breakpoint
CREATE TABLE `bank_reconciliation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`reconciliation_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`account_id` text NOT NULL,
	`currency` text NOT NULL,
	`baseline_date` text NOT NULL,
	`opening_book_cents` integer NOT NULL,
	`closing_book_cents` integer NOT NULL,
	`uncleared_cents` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`status` text NOT NULL,
	`reopen_reason` text DEFAULT '' NOT NULL,
	`actor_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reconciliation_id`) REFERENCES `reconciliations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bank_reconciliation_run_status" CHECK("bank_reconciliation_runs"."status" IN ('staging','completed','reopened'))
);
--> statement-breakpoint
CREATE INDEX `bank_reconciliation_source_idx` ON `bank_reconciliation_runs` (`organization_id`,`source_type`,`source_id`);--> statement-breakpoint
CREATE TRIGGER bank_csv_import_validate BEFORE INSERT ON bank_csv_imports
BEGIN
 SELECT RAISE(ABORT,'BANK_CSV_ACCOUNT') WHERE NOT EXISTS(SELECT 1 FROM bank_accounts b JOIN financial_accounts a ON a.id=b.financial_account_id AND a.organization_id=b.organization_id JOIN bookloq_settings s ON s.organization_id=b.organization_id WHERE b.id=NEW.bank_account_id AND b.organization_id=NEW.organization_id AND b.financial_account_id=NEW.financial_account_id AND b.currency=NEW.currency AND b.provider='manual' AND b.connection_status='manual' AND b.demo_record=0 AND a.active=1 AND a.account_type='asset' AND a.normal_balance='debit' AND a.account_subtype IN ('cash','bank') AND s.status='active' AND s.data_mode='live' AND s.base_currency=NEW.currency);
 SELECT RAISE(ABORT,'BANK_CSV_OVERLAP') WHERE EXISTS(SELECT 1 FROM bank_csv_imports s WHERE s.organization_id=NEW.organization_id AND s.bank_account_id=NEW.bank_account_id AND s.start_date<=NEW.end_date AND s.end_date>=NEW.start_date) OR EXISTS(SELECT 1 FROM bank_statement_imports s WHERE s.organization_id=NEW.organization_id AND s.bank_account_id=NEW.bank_account_id AND s.start_date<=NEW.end_date AND s.end_date>=NEW.start_date);
END;
--> statement-breakpoint
CREATE TRIGGER bank_statement_csv_overlap BEFORE INSERT ON bank_statement_imports
BEGIN SELECT RAISE(ABORT,'STATEMENT_PERIOD_OVERLAP') WHERE EXISTS(SELECT 1 FROM bank_csv_imports s WHERE s.organization_id=NEW.organization_id AND s.bank_account_id=NEW.bank_account_id AND s.start_date<=NEW.end_date AND s.end_date>=NEW.start_date); END;
--> statement-breakpoint
CREATE TRIGGER bank_csv_approve_validate BEFORE UPDATE OF status ON bank_csv_imports WHEN NEW.status='approved'
BEGIN
 SELECT RAISE(ABORT,'BANK_CSV_ROWS') WHERE (SELECT COUNT(*) FROM bank_csv_rows WHERE import_id=NEW.id)<>NEW.row_count OR EXISTS(SELECT 1 FROM bank_csv_rows r LEFT JOIN financial_transactions t ON t.id=r.transaction_id WHERE r.import_id=NEW.id AND (t.id IS NULL OR t.organization_id<>NEW.organization_id OR t.account_id<>NEW.financial_account_id OR t.currency<>NEW.currency OR t.demo_record<>0 OR t.source_system<>'bank_csv' OR t.source_state<>'posted' OR t.journal_entry_id IS NOT NULL OR t.posting_date<NEW.start_date OR t.posting_date>NEW.end_date));
 SELECT RAISE(ABORT,'BANK_CSV_TOTALS') WHERE (SELECT COALESCE(SUM(max(t.amount_cents,0)),0) FROM bank_csv_rows r JOIN financial_transactions t ON t.id=r.transaction_id WHERE r.import_id=NEW.id)<>NEW.inflow_cents OR (SELECT COALESCE(SUM(max(-t.amount_cents,0)),0) FROM bank_csv_rows r JOIN financial_transactions t ON t.id=r.transaction_id WHERE r.import_id=NEW.id)<>NEW.outflow_cents;
END;
--> statement-breakpoint
CREATE TRIGGER bank_csv_import_immutable BEFORE UPDATE ON bank_csv_imports WHEN OLD.status='approved'
BEGIN SELECT RAISE(ABORT,'BANK_CSV_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER bank_csv_import_retained BEFORE DELETE ON bank_csv_imports WHEN EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.organization_id)
BEGIN SELECT RAISE(ABORT,'BANK_CSV_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER bank_csv_row_retained_update BEFORE UPDATE ON bank_csv_rows
BEGIN SELECT RAISE(ABORT,'BANK_CSV_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER bank_csv_row_retained_delete BEFORE DELETE ON bank_csv_rows WHEN EXISTS(SELECT 1 FROM bank_csv_imports s JOIN workspaces w ON w.id=s.organization_id WHERE s.id=OLD.import_id)
BEGIN SELECT RAISE(ABORT,'BANK_CSV_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER bank_source_transaction_immutable BEFORE UPDATE OF account_id,amount_cents,currency,posting_date,source_system,external_source_id,source_state,demo_record ON financial_transactions
WHEN (EXISTS(SELECT 1 FROM bank_csv_rows r WHERE r.transaction_id=OLD.id) OR OLD.journal_entry_id IS NOT NULL OR OLD.reconciliation_status='reconciled') AND (NEW.account_id IS NOT OLD.account_id OR NEW.amount_cents<>OLD.amount_cents OR NEW.currency<>OLD.currency OR NEW.posting_date<>OLD.posting_date OR NEW.source_state<>OLD.source_state OR NEW.demo_record<>OLD.demo_record OR ((NEW.source_system<>OLD.source_system OR NEW.external_source_id<>OLD.external_source_id) AND NOT (OLD.source_system='plaid' AND NEW.source_system='retained_accounting' AND NEW.external_source_id='retained:'||OLD.id)))
BEGIN SELECT RAISE(ABORT,'BANK_SOURCE_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER bank_source_transaction_retained BEFORE DELETE ON financial_transactions
WHEN EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.organization_id) AND (EXISTS(SELECT 1 FROM bank_csv_rows r WHERE r.transaction_id=OLD.id) OR EXISTS(SELECT 1 FROM bank_accounting_events e WHERE e.transaction_id=OLD.id) OR EXISTS(SELECT 1 FROM invoice_accounting_events e WHERE e.source_transaction_id=OLD.id) OR OLD.reconciliation_status='reconciled')
BEGIN SELECT RAISE(ABORT,'BANK_SOURCE_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER bank_statement_accounting_undo BEFORE DELETE ON bank_statement_imports WHEN EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.organization_id)
BEGIN SELECT RAISE(ABORT,'STATEMENT_UNDO_REVIEW_REQUIRED') WHERE EXISTS(SELECT 1 FROM bank_statement_rows r WHERE r.import_id=OLD.id AND (EXISTS(SELECT 1 FROM bank_accounting_events e WHERE e.transaction_id=r.transaction_id) OR EXISTS(SELECT 1 FROM invoice_accounting_events e WHERE e.source_transaction_id=r.transaction_id))); END;
--> statement-breakpoint
CREATE TRIGGER bank_accounting_validate BEFORE INSERT ON bank_accounting_events
BEGIN
 SELECT RAISE(ABORT,'BANK_TRANSACTION_CHANGED') WHERE NOT EXISTS(
  SELECT 1 FROM financial_transactions t JOIN financial_accounts a ON a.id=t.account_id AND a.organization_id=t.organization_id JOIN bookloq_settings s ON s.organization_id=t.organization_id
  WHERE t.id=NEW.transaction_id AND t.organization_id=NEW.organization_id AND t.account_id=NEW.cash_account_id AND t.amount_cents=NEW.amount_cents AND t.demo_record=0 AND t.source_state='posted' AND t.reconciliation_status<>'reconciled'
  AND a.active=1 AND a.account_type='asset' AND a.normal_balance='debit' AND a.account_subtype IN ('bank','cash') AND s.status='active' AND s.data_mode='live' AND s.accounting_basis='accrual' AND s.base_currency=t.currency
  AND ((NEW.event_type IN ('post','match') AND t.journal_entry_id IS NULL AND NEW.reversal_of_event_id IS NULL) OR (NEW.event_type IN ('reverse','unmatch') AND EXISTS(SELECT 1 FROM bank_accounting_events e WHERE e.id=NEW.reversal_of_event_id AND e.organization_id=NEW.organization_id AND e.transaction_id=t.id AND e.event_type=CASE NEW.event_type WHEN 'reverse' THEN 'post' ELSE 'match' END AND t.journal_entry_id=e.journal_entry_id)))
  AND (t.source_system<>'plaid' OR EXISTS(SELECT 1 FROM bank_accounts b JOIN integration_connections c ON c.organization_id=b.organization_id AND c.provider='plaid' AND c.external_account_ref=b.external_item_ref WHERE b.organization_id=t.organization_id AND b.financial_account_id=t.account_id AND b.provider='plaid' AND b.external_item_ref IS NOT NULL AND c.status='connected' AND c.data_promotion_status='approved' AND (c.sync_lease_owner IS NULL OR c.sync_lease_expires_at IS NULL OR c.sync_lease_expires_at<=CAST(strftime('%s','now') AS INTEGER))))
  AND NOT EXISTS(SELECT 1 FROM bookloq_transaction_matches m WHERE m.organization_id=t.organization_id AND m.transaction_id=t.id AND m.status='confirmed' AND (m.customer_invoice_id IS NOT NULL OR m.supplier_bill_id IS NOT NULL)));
 SELECT RAISE(ABORT,'BANK_JOURNAL_CHANGED') WHERE NOT EXISTS(
  SELECT 1 FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id JOIN financial_transactions t ON t.id=NEW.transaction_id AND t.organization_id=NEW.organization_id
  WHERE l.id=NEW.cash_line_id AND l.organization_id=NEW.organization_id AND l.journal_entry_id=NEW.journal_entry_id AND l.account_id=NEW.cash_account_id AND j.status='posted' AND j.currency=t.currency
  AND l.debit_cents-l.credit_cents=CASE NEW.event_type WHEN 'reverse' THEN -NEW.amount_cents ELSE NEW.amount_cents END
  AND j.total_debit_cents=j.total_credit_cents AND j.total_debit_cents=(SELECT SUM(debit_cents) FROM journal_lines WHERE journal_entry_id=j.id AND organization_id=j.organization_id) AND j.total_credit_cents=(SELECT SUM(credit_cents) FROM journal_lines WHERE journal_entry_id=j.id AND organization_id=j.organization_id)
  AND NOT EXISTS(SELECT 1 FROM journal_lines other WHERE other.journal_entry_id=j.id AND other.organization_id<>j.organization_id)
  AND (SELECT COUNT(*) FROM journal_lines other WHERE other.journal_entry_id=j.id AND other.account_id=NEW.cash_account_id)=1
  AND ((NEW.event_type='post' AND j.source_type='bank_transaction' AND j.source_ref=t.id AND j.entry_date=t.posting_date AND j.idempotency_key=NEW.idempotency_key AND j.total_debit_cents=abs(NEW.amount_cents)) OR (NEW.event_type='reverse' AND j.source_type='reversal' AND j.entry_date=NEW.event_date AND j.idempotency_key=NEW.idempotency_key) OR (NEW.event_type IN ('match','unmatch') AND j.entry_date<=t.posting_date))
  AND (NEW.event_type NOT IN ('post','reverse') OR EXISTS(SELECT 1 FROM accounting_periods p WHERE p.id=j.period_id AND p.organization_id=j.organization_id AND p.status IN ('open','review') AND j.entry_date BETWEEN p.start_date AND p.end_date)));
 SELECT RAISE(ABORT,'BANK_LINE_USED') WHERE NEW.event_type IN ('post','match') AND (EXISTS(SELECT 1 FROM bank_reconciliation_lines r WHERE r.cash_line_id=NEW.cash_line_id AND r.active=1) OR EXISTS(SELECT 1 FROM bank_accounting_events e WHERE e.cash_line_id=NEW.cash_line_id AND e.event_type IN ('post','match') AND NOT EXISTS(SELECT 1 FROM bank_accounting_events rev WHERE rev.organization_id=e.organization_id AND rev.reversal_of_event_id=e.id)) OR EXISTS(SELECT 1 FROM financial_transactions t WHERE t.organization_id=NEW.organization_id AND t.account_id=NEW.cash_account_id AND t.journal_entry_id=NEW.journal_entry_id AND t.id<>NEW.transaction_id));
 SELECT RAISE(ABORT,'BANK_COUNTER_ACCOUNT') WHERE NEW.event_type='post' AND NOT EXISTS(SELECT 1 FROM financial_accounts a WHERE a.id=NEW.counter_account_id AND a.organization_id=NEW.organization_id AND a.active=1 AND a.id<>NEW.cash_account_id AND a.account_subtype NOT IN ('receivable','payable') AND COALESCE(a.system_key,'') NOT IN ('accounts_receivable','accounts_payable'));
 SELECT RAISE(ABORT,'BANK_CORRECTION_CHANGED') WHERE NEW.event_type IN ('reverse','unmatch') AND NOT EXISTS(
  SELECT 1 FROM bank_accounting_events e JOIN journal_entries old ON old.id=e.journal_entry_id AND old.organization_id=e.organization_id JOIN journal_entries correction ON correction.id=NEW.journal_entry_id AND correction.organization_id=NEW.organization_id
  WHERE e.id=NEW.reversal_of_event_id AND e.organization_id=NEW.organization_id AND e.transaction_id=NEW.transaction_id AND e.amount_cents=NEW.amount_cents AND e.cash_account_id=NEW.cash_account_id AND old.status='posted'
  AND NOT EXISTS(SELECT 1 FROM bank_reconciliation_lines r WHERE r.cash_line_id=e.cash_line_id AND r.active=1)
  AND ((NEW.event_type='unmatch' AND NEW.journal_entry_id=e.journal_entry_id AND NEW.cash_line_id=e.cash_line_id) OR (NEW.event_type='reverse' AND correction.reversal_of_entry_id=old.id AND correction.source_ref=old.id
   AND NOT EXISTS(SELECT 1 FROM financial_transactions t WHERE t.organization_id=NEW.organization_id AND t.journal_entry_id=old.id AND t.id<>NEW.transaction_id)
   AND (SELECT COUNT(*) FROM journal_lines WHERE journal_entry_id=old.id)=(SELECT COUNT(*) FROM journal_lines WHERE journal_entry_id=correction.id)
   AND NOT EXISTS(SELECT 1 FROM journal_lines prior LEFT JOIN journal_lines current ON current.journal_entry_id=correction.id AND current.line_number=prior.line_number WHERE prior.journal_entry_id=old.id AND (current.id IS NULL OR current.account_id<>prior.account_id OR current.debit_cents<>prior.credit_cents OR current.credit_cents<>prior.debit_cents OR current.contact_id IS NOT prior.contact_id OR current.location_ref<>prior.location_ref OR current.department_ref IS NOT prior.department_ref OR current.project_ref IS NOT prior.project_ref OR current.tax_code IS NOT prior.tax_code OR current.tax_amount_cents<>prior.tax_amount_cents)))));
END;
--> statement-breakpoint
CREATE TRIGGER bank_accounting_apply AFTER INSERT ON bank_accounting_events
BEGIN
 UPDATE financial_transactions SET journal_entry_id=NEW.journal_entry_id,category_account_id=CASE WHEN NEW.event_type='post' THEN NEW.counter_account_id ELSE category_account_id END,categorization_status=CASE WHEN NEW.event_type='post' THEN 'confirmed' ELSE categorization_status END,reconciliation_status=CASE WHEN NEW.event_type='match' THEN 'matched' ELSE 'unreconciled' END,updated_at=NEW.created_at WHERE id=NEW.transaction_id AND organization_id=NEW.organization_id AND NEW.event_type IN ('post','match');
 UPDATE financial_transactions SET journal_entry_id=NULL,reconciliation_status='unreconciled',updated_at=NEW.created_at WHERE id=NEW.transaction_id AND organization_id=NEW.organization_id AND NEW.event_type IN ('reverse','unmatch');
 UPDATE journal_entries SET status='reversed',updated_at=NEW.created_at WHERE id=(SELECT journal_entry_id FROM bank_accounting_events WHERE id=NEW.reversal_of_event_id) AND organization_id=NEW.organization_id AND NEW.event_type='reverse';
END;
--> statement-breakpoint
CREATE TRIGGER bank_accounting_immutable BEFORE UPDATE ON bank_accounting_events BEGIN SELECT RAISE(ABORT,'BANK_ACCOUNTING_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER bank_accounting_retained BEFORE DELETE ON bank_accounting_events WHEN EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.organization_id) BEGIN SELECT RAISE(ABORT,'BANK_ACCOUNTING_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER automatic_journal_lines_insert BEFORE INSERT ON journal_lines
WHEN EXISTS(SELECT 1 FROM invoice_accounting_events e WHERE e.journal_entry_id=NEW.journal_entry_id) OR EXISTS(SELECT 1 FROM bank_accounting_events e WHERE e.journal_entry_id=NEW.journal_entry_id AND (e.event_type IN ('post','reverse') OR (e.event_type='match' AND NOT EXISTS(SELECT 1 FROM bank_accounting_events r WHERE r.reversal_of_event_id=e.id))))
BEGIN SELECT RAISE(ABORT,'BANK_JOURNAL_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER bank_journal_lines_update BEFORE UPDATE ON journal_lines
WHEN EXISTS(SELECT 1 FROM bank_accounting_events e WHERE e.journal_entry_id=OLD.journal_entry_id AND (e.event_type IN ('post','reverse') OR (e.event_type='match' AND NOT EXISTS(SELECT 1 FROM bank_accounting_events r WHERE r.reversal_of_event_id=e.id)))) OR EXISTS(SELECT 1 FROM bank_reconciliation_lines r WHERE r.cash_line_id=OLD.id AND r.active=1)
BEGIN SELECT RAISE(ABORT,'BANK_JOURNAL_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER bank_journal_lines_delete BEFORE DELETE ON journal_lines
WHEN EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.organization_id) AND (EXISTS(SELECT 1 FROM bank_accounting_events e WHERE e.journal_entry_id=OLD.journal_entry_id) OR EXISTS(SELECT 1 FROM bank_reconciliation_lines r WHERE r.cash_line_id=OLD.id AND r.active=1))
BEGIN SELECT RAISE(ABORT,'BANK_JOURNAL_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER bank_reconciled_backdate BEFORE INSERT ON journal_lines
BEGIN SELECT RAISE(ABORT,'BANK_RECONCILED_BACKDATE') WHERE EXISTS(SELECT 1 FROM bank_reconciliation_runs r JOIN reconciliations q ON q.id=r.reconciliation_id JOIN journal_entries j ON j.id=NEW.journal_entry_id WHERE r.organization_id=NEW.organization_id AND r.account_id=NEW.account_id AND r.status='completed' AND j.entry_date<=q.end_date); END;
--> statement-breakpoint
CREATE TRIGGER bank_reconciliation_complete BEFORE UPDATE OF status ON bank_reconciliation_runs WHEN NEW.status='completed'
BEGIN
 SELECT RAISE(ABORT,'BANK_RECONCILIATION_CHANGED') WHERE OLD.status<>'staging' OR EXISTS(SELECT 1 FROM bank_reconciliation_runs r WHERE r.organization_id=NEW.organization_id AND r.source_type=NEW.source_type AND r.source_id=NEW.source_id AND r.status='completed');
 SELECT RAISE(ABORT,'BANK_RECONCILIATION_SOURCE') WHERE NOT EXISTS(SELECT 1 FROM reconciliations q WHERE q.id=NEW.reconciliation_id AND q.organization_id=NEW.organization_id AND q.account_id=NEW.account_id AND q.status='prepared' AND q.difference_cents=0 AND q.book_balance_cents=NEW.closing_book_cents
  AND ((NEW.source_type='csv' AND EXISTS(SELECT 1 FROM bank_csv_imports s WHERE s.id=NEW.source_id AND s.organization_id=NEW.organization_id AND s.financial_account_id=NEW.account_id AND s.status='approved' AND s.currency=NEW.currency AND s.start_date=q.start_date AND s.end_date=q.end_date AND s.opening_balance_cents=q.opening_balance_cents AND s.closing_balance_cents=q.closing_balance_cents)) OR (NEW.source_type='statement' AND EXISTS(SELECT 1 FROM bank_statement_imports s WHERE s.id=NEW.source_id AND s.organization_id=NEW.organization_id AND s.financial_account_id=NEW.account_id AND s.status='approved' AND s.demo_record=0 AND s.currency=NEW.currency AND s.start_date=q.start_date AND s.end_date=q.end_date AND s.opening_balance_cents=q.opening_balance_cents AND s.closing_balance_cents=q.closing_balance_cents)))
  AND EXISTS(SELECT 1 FROM accounting_periods p WHERE p.organization_id=NEW.organization_id AND p.status IN ('open','review') AND q.end_date BETWEEN p.start_date AND p.end_date));
 SELECT RAISE(ABORT,'BANK_RECONCILIATION_ROWS') WHERE (SELECT COUNT(*) FROM bank_reconciliation_lines WHERE run_id=NEW.id)<>CASE NEW.source_type WHEN 'csv' THEN (SELECT row_count FROM bank_csv_imports WHERE id=NEW.source_id) ELSE (SELECT row_count FROM bank_statement_imports WHERE id=NEW.source_id) END
  OR EXISTS(SELECT 1 FROM bank_reconciliation_lines r LEFT JOIN financial_transactions t ON t.id=r.transaction_id LEFT JOIN journal_lines l ON l.id=r.cash_line_id LEFT JOIN journal_entries j ON j.id=l.journal_entry_id WHERE r.run_id=NEW.id AND (t.id IS NULL OR l.id IS NULL OR t.organization_id<>NEW.organization_id OR l.organization_id<>NEW.organization_id OR r.organization_id<>NEW.organization_id OR r.active<>1 OR t.account_id<>NEW.account_id OR t.demo_record<>0 OR t.source_state<>'posted' OR t.currency<>NEW.currency OR t.amount_cents<>r.amount_cents OR l.account_id<>NEW.account_id OR l.debit_cents-l.credit_cents<>r.amount_cents OR t.journal_entry_id IS NOT j.id OR j.status NOT IN ('posted','reversed') OR j.currency<>NEW.currency OR j.entry_date>(SELECT end_date FROM reconciliations WHERE id=NEW.reconciliation_id) OR (NEW.source_type='csv' AND NOT EXISTS(SELECT 1 FROM bank_csv_rows s WHERE s.import_id=NEW.source_id AND s.transaction_id=t.id)) OR (NEW.source_type='statement' AND NOT EXISTS(SELECT 1 FROM bank_statement_rows s WHERE s.import_id=NEW.source_id AND s.transaction_id=t.id))));
 SELECT RAISE(ABORT,'BANK_RECONCILIATION_LEDGER') WHERE NEW.closing_book_cents<>(SELECT COALESCE(SUM(l.debit_cents-l.credit_cents),0) FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id WHERE l.organization_id=NEW.organization_id AND l.account_id=NEW.account_id AND j.status IN ('posted','reversed') AND j.entry_date<=(SELECT end_date FROM reconciliations WHERE id=NEW.reconciliation_id))
  OR NEW.opening_book_cents<>(SELECT COALESCE(SUM(l.debit_cents-l.credit_cents),0) FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id WHERE l.organization_id=NEW.organization_id AND l.account_id=NEW.account_id AND j.status IN ('posted','reversed') AND j.entry_date<(SELECT start_date FROM reconciliations WHERE id=NEW.reconciliation_id))
  OR NEW.uncleared_cents<>(SELECT COALESCE(SUM(l.debit_cents-l.credit_cents),0) FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id WHERE l.organization_id=NEW.organization_id AND l.account_id=NEW.account_id AND j.status IN ('posted','reversed') AND j.entry_date BETWEEN NEW.baseline_date AND (SELECT end_date FROM reconciliations WHERE id=NEW.reconciliation_id) AND NOT EXISTS(SELECT 1 FROM bank_reconciliation_lines used WHERE used.cash_line_id=l.id AND used.active=1))
  OR NEW.closing_book_cents-NEW.uncleared_cents<>(SELECT closing_balance_cents FROM reconciliations WHERE id=NEW.reconciliation_id);
 SELECT RAISE(ABORT,'BANK_RECONCILIATION_OPENING') WHERE (NEW.baseline_date=(SELECT start_date FROM reconciliations WHERE id=NEW.reconciliation_id) AND NEW.opening_book_cents<>(SELECT opening_balance_cents FROM reconciliations WHERE id=NEW.reconciliation_id)) OR (NEW.baseline_date<>(SELECT start_date FROM reconciliations WHERE id=NEW.reconciliation_id) AND NOT EXISTS(SELECT 1 FROM bank_reconciliation_runs prior JOIN reconciliations q ON q.id=prior.reconciliation_id WHERE prior.organization_id=NEW.organization_id AND prior.account_id=NEW.account_id AND prior.status='completed' AND prior.baseline_date=NEW.baseline_date AND date(q.end_date,'+1 day')=(SELECT start_date FROM reconciliations WHERE id=NEW.reconciliation_id) AND q.closing_balance_cents=(SELECT opening_balance_cents FROM reconciliations WHERE id=NEW.reconciliation_id)));
END;
--> statement-breakpoint
CREATE TRIGGER bank_reconciliation_apply AFTER UPDATE OF status ON bank_reconciliation_runs WHEN NEW.status='completed'
BEGIN
 UPDATE reconciliations SET status='completed',completed_at=NEW.created_at,updated_at=NEW.created_at WHERE id=NEW.reconciliation_id;
 UPDATE financial_transactions SET reconciliation_status='reconciled',updated_at=NEW.created_at WHERE organization_id=NEW.organization_id AND id IN (SELECT transaction_id FROM bank_reconciliation_lines WHERE run_id=NEW.id AND active=1);
 UPDATE bank_accounts SET last_reconciled_at=NEW.created_at WHERE organization_id=NEW.organization_id AND financial_account_id=NEW.account_id;
END;
--> statement-breakpoint
CREATE TRIGGER bank_reconciliation_reopen BEFORE UPDATE OF status ON bank_reconciliation_runs WHEN NEW.status='reopened'
BEGIN
 SELECT RAISE(ABORT,'BANK_RECONCILIATION_REOPEN') WHERE OLD.status<>'completed' OR length(trim(NEW.reopen_reason))=0 OR EXISTS(SELECT 1 FROM bank_reconciliation_runs r JOIN reconciliations q ON q.id=r.reconciliation_id WHERE r.organization_id=OLD.organization_id AND r.account_id=OLD.account_id AND r.status='completed' AND q.end_date>(SELECT end_date FROM reconciliations WHERE id=OLD.reconciliation_id)) OR NOT EXISTS(SELECT 1 FROM reconciliations q JOIN accounting_periods p ON p.organization_id=q.organization_id AND q.end_date BETWEEN p.start_date AND p.end_date WHERE q.id=OLD.reconciliation_id AND p.status IN ('open','review'));
END;
--> statement-breakpoint
CREATE TRIGGER bank_reconciliation_reopen_apply AFTER UPDATE OF status ON bank_reconciliation_runs WHEN NEW.status='reopened'
BEGIN
 UPDATE bank_reconciliation_lines SET active=0 WHERE run_id=NEW.id;
 UPDATE financial_transactions SET reconciliation_status='unreconciled' WHERE organization_id=NEW.organization_id AND id IN (SELECT transaction_id FROM bank_reconciliation_lines WHERE run_id=NEW.id);
 UPDATE reconciliations SET status='prepared',completed_at=NULL,updated_at=CAST(strftime('%s','now') AS INTEGER) WHERE id=NEW.reconciliation_id;
 UPDATE bank_accounts SET last_reconciled_at=(SELECT MAX(r.created_at) FROM bank_reconciliation_runs r WHERE r.organization_id=NEW.organization_id AND r.account_id=NEW.account_id AND r.status='completed') WHERE organization_id=NEW.organization_id AND financial_account_id=NEW.account_id;
END;
--> statement-breakpoint
CREATE TRIGGER bank_reconciliation_immutable BEFORE UPDATE ON bank_reconciliation_runs WHEN OLD.status IN ('completed','reopened') AND NOT (OLD.status='completed' AND NEW.status='reopened' AND NEW.id=OLD.id AND NEW.organization_id=OLD.organization_id AND NEW.reconciliation_id=OLD.reconciliation_id AND NEW.source_id=OLD.source_id AND NEW.source_type=OLD.source_type AND NEW.account_id=OLD.account_id AND NEW.currency=OLD.currency AND NEW.baseline_date=OLD.baseline_date AND NEW.opening_book_cents=OLD.opening_book_cents AND NEW.closing_book_cents=OLD.closing_book_cents AND NEW.uncleared_cents=OLD.uncleared_cents AND NEW.fingerprint=OLD.fingerprint AND NEW.snapshot_json=OLD.snapshot_json AND NEW.actor_user_id=OLD.actor_user_id AND NEW.created_at=OLD.created_at)
BEGIN SELECT RAISE(ABORT,'BANK_RECONCILIATION_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER bank_reconciliation_retained BEFORE DELETE ON bank_reconciliation_runs WHEN EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.organization_id) BEGIN SELECT RAISE(ABORT,'BANK_RECONCILIATION_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER bank_reconciliation_line_immutable BEFORE UPDATE ON bank_reconciliation_lines WHEN NOT(OLD.active=1 AND NEW.active=0 AND EXISTS(SELECT 1 FROM bank_reconciliation_runs r WHERE r.id=OLD.run_id AND r.status='reopened') AND NEW.run_id=OLD.run_id AND NEW.organization_id=OLD.organization_id AND NEW.transaction_id=OLD.transaction_id AND NEW.cash_line_id=OLD.cash_line_id AND NEW.amount_cents=OLD.amount_cents)
BEGIN SELECT RAISE(ABORT,'BANK_RECONCILIATION_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER bank_reconciliation_line_retained BEFORE DELETE ON bank_reconciliation_lines WHEN EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.organization_id) BEGIN SELECT RAISE(ABORT,'BANK_RECONCILIATION_RETAINED'); END;
