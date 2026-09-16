CREATE TABLE `bank_statement_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`document_id` text NOT NULL,
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
	`fingerprint` text NOT NULL,
	`demo_record` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`approved_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `workspace_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`financial_account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bank_statement_row_count" CHECK("bank_statement_imports"."row_count" BETWEEN 1 AND 500),
	CONSTRAINT "bank_statement_totals_positive" CHECK("bank_statement_imports"."inflow_cents" >= 0 AND "bank_statement_imports"."outflow_cents" >= 0),
	CONSTRAINT "bank_statement_mode" CHECK("bank_statement_imports"."demo_record" IN (0, 1)),
	CONSTRAINT "bank_statement_status" CHECK("bank_statement_imports"."status" IN ('staging', 'approved')),
	CONSTRAINT "bank_statement_dates" CHECK("bank_statement_imports"."start_date" <= "bank_statement_imports"."end_date"),
	CONSTRAINT "bank_statement_balance" CHECK("bank_statement_imports"."opening_balance_cents" + "bank_statement_imports"."inflow_cents" - "bank_statement_imports"."outflow_cents" = "bank_statement_imports"."closing_balance_cents")
);
--> statement-breakpoint
CREATE INDEX `bank_statement_account_period` ON `bank_statement_imports` (`organization_id`,`bank_account_id`,`start_date`,`end_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `bank_statement_imports_organization_id_document_id_unique` ON `bank_statement_imports` (`organization_id`,`document_id`);--> statement-breakpoint
CREATE TABLE `bank_statement_rows` (
	`import_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`row_number` integer NOT NULL,
	PRIMARY KEY(`import_id`, `row_number`),
	FOREIGN KEY (`import_id`) REFERENCES `bank_statement_imports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `financial_transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "bank_statement_row_number" CHECK("bank_statement_rows"."row_number" BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_statement_rows_transaction_id_unique` ON `bank_statement_rows` (`transaction_id`);
--> statement-breakpoint
CREATE TRIGGER bank_statement_import_guard BEFORE INSERT ON bank_statement_imports
BEGIN
 SELECT RAISE(ABORT,'STATEMENT_DOCUMENT_UNAVAILABLE') WHERE NOT EXISTS (SELECT 1 FROM workspace_documents d WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.security_state='clean' AND d.scan_status='clean' AND d.status IN ('review_required','uploaded') AND d.document_type IN ('bank_statement','other'));
 SELECT RAISE(ABORT,'STATEMENT_ACCOUNT_UNAVAILABLE') WHERE NOT EXISTS (SELECT 1 FROM bank_accounts b JOIN financial_accounts a ON a.id=b.financial_account_id AND a.organization_id=b.organization_id WHERE b.id=NEW.bank_account_id AND b.organization_id=NEW.organization_id AND b.financial_account_id=NEW.financial_account_id AND b.provider='manual' AND b.connection_status='manual' AND b.account_type IN ('chequing','savings','merchant') AND a.active=1 AND a.account_type='asset' AND UPPER(b.currency)=NEW.currency AND b.demo_record=NEW.demo_record);
 SELECT RAISE(ABORT,'STATEMENT_PERIOD_OVERLAP') WHERE EXISTS (SELECT 1 FROM bank_statement_imports s WHERE s.organization_id=NEW.organization_id AND s.bank_account_id=NEW.bank_account_id AND s.start_date<=NEW.end_date AND s.end_date>=NEW.start_date);
END;
--> statement-breakpoint
CREATE TRIGGER bank_statement_approve_guard BEFORE UPDATE OF status ON bank_statement_imports WHEN NEW.status='approved'
BEGIN
 SELECT RAISE(ABORT,'STATEMENT_ROWS_INCOMPLETE') WHERE (SELECT COUNT(*) FROM bank_statement_rows WHERE import_id=NEW.id) <> NEW.row_count;
 SELECT RAISE(ABORT,'STATEMENT_DOCUMENT_UNAVAILABLE') WHERE NOT EXISTS (SELECT 1 FROM workspace_documents d WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.security_state='clean' AND d.scan_status='clean' AND d.status IN ('review_required','uploaded'));
 SELECT RAISE(ABORT,'STATEMENT_ROWS_INVALID') WHERE EXISTS (SELECT 1 FROM bank_statement_rows r JOIN financial_transactions t ON t.id=r.transaction_id WHERE r.import_id=NEW.id AND (t.organization_id<>NEW.organization_id OR t.account_id<>NEW.financial_account_id OR t.currency<>NEW.currency OR t.demo_record<>NEW.demo_record OR t.source_system<>'bank_statement' OR t.journal_entry_id IS NOT NULL OR t.posting_date<NEW.start_date OR t.posting_date>NEW.end_date));
 SELECT RAISE(ABORT,'STATEMENT_TOTALS_INVALID') WHERE (SELECT COALESCE(SUM(max(t.amount_cents,0)),0) FROM bank_statement_rows r JOIN financial_transactions t ON t.id=r.transaction_id WHERE r.import_id=NEW.id)<>NEW.inflow_cents OR (SELECT COALESCE(SUM(max(-t.amount_cents,0)),0) FROM bank_statement_rows r JOIN financial_transactions t ON t.id=r.transaction_id WHERE r.import_id=NEW.id)<>NEW.outflow_cents;
END;
--> statement-breakpoint
CREATE TRIGGER bank_statement_manual_identity_guard BEFORE INSERT ON bank_accounts WHEN NEW.provider='manual' AND length(NEW.masked_number)>=4
BEGIN
 SELECT RAISE(ABORT,'STATEMENT_ACCOUNT_EXISTS') WHERE EXISTS (SELECT 1 FROM bank_accounts b WHERE b.organization_id=NEW.organization_id AND lower(trim(b.institution_name))=lower(trim(NEW.institution_name)) AND substr(b.masked_number,-4)=substr(NEW.masked_number,-4) AND b.currency=NEW.currency AND b.demo_record=NEW.demo_record);
END;
--> statement-breakpoint
-- Workspace deletion has its own complete tenant cascade. An ordinary undo may
-- remove only unchanged, unposted activity that has not entered reconciliation.
CREATE TRIGGER bank_statement_undo_guard BEFORE DELETE ON bank_statement_imports
WHEN OLD.status='approved' AND EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.organization_id)
BEGIN
 SELECT RAISE(ABORT,'STATEMENT_UNDO_REVIEW_REQUIRED') WHERE (SELECT COUNT(*) FROM bank_statement_rows WHERE import_id=OLD.id)<>OLD.row_count;
 SELECT RAISE(ABORT,'STATEMENT_UNDO_REVIEW_REQUIRED') WHERE EXISTS(SELECT 1 FROM bank_statement_rows r JOIN financial_transactions t ON t.id=r.transaction_id WHERE r.import_id=OLD.id AND (t.organization_id<>OLD.organization_id OR t.account_id<>OLD.financial_account_id OR t.currency<>OLD.currency OR t.demo_record<>OLD.demo_record OR t.posting_date<OLD.start_date OR t.posting_date>OLD.end_date OR t.source_system<>'bank_statement' OR t.source_state<>'posted' OR t.journal_entry_id IS NOT NULL OR t.reconciliation_status<>'unreconciled' OR EXISTS(SELECT 1 FROM bookloq_transaction_matches m WHERE m.transaction_id=t.id AND m.organization_id=OLD.organization_id AND m.status='confirmed')));
 SELECT RAISE(ABORT,'STATEMENT_UNDO_REVIEW_REQUIRED') WHERE (SELECT COALESCE(SUM(max(t.amount_cents,0)),0) FROM bank_statement_rows r JOIN financial_transactions t ON t.id=r.transaction_id WHERE r.import_id=OLD.id)<>OLD.inflow_cents OR (SELECT COALESCE(SUM(max(-t.amount_cents,0)),0) FROM bank_statement_rows r JOIN financial_transactions t ON t.id=r.transaction_id WHERE r.import_id=OLD.id)<>OLD.outflow_cents;
 DELETE FROM financial_transactions WHERE organization_id=OLD.organization_id AND source_system='bank_statement' AND id IN (SELECT transaction_id FROM bank_statement_rows WHERE import_id=OLD.id);
 UPDATE workspace_documents SET status='review_required',updated_at=CAST(strftime('%s','now') AS INTEGER) WHERE id=OLD.document_id AND organization_id=OLD.organization_id AND status='approved';
END;
