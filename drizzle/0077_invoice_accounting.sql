CREATE TABLE `invoice_accounting_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`event_type` text NOT NULL,
	`event_date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`invoice_total_cents` integer NOT NULL,
	`prior_paid_cents` integer NOT NULL,
	`invoice_journal_entry_id` text NOT NULL,
	`journal_entry_id` text NOT NULL,
	`reversal_of_event_id` text,
	`cash_account_id` text,
	`source_transaction_id` text,
	`reference` text DEFAULT '' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_json` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `customer_invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_transaction_id`) REFERENCES `financial_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invoice_accounting_type_check" CHECK("invoice_accounting_events"."event_type" in ('issue','payment','reverse_payment','void')),
	CONSTRAINT "invoice_accounting_amount_check" CHECK(typeof("invoice_accounting_events"."amount_cents") = 'integer' and "invoice_accounting_events"."amount_cents" > 0 and "invoice_accounting_events"."amount_cents" <= 9007199254740991 and typeof("invoice_accounting_events"."prior_paid_cents") = 'integer' and "invoice_accounting_events"."prior_paid_cents" >= 0 and "invoice_accounting_events"."prior_paid_cents" <= "invoice_accounting_events"."invoice_total_cents")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_accounting_request_unique` ON `invoice_accounting_events` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_accounting_journal_unique` ON `invoice_accounting_events` (`journal_entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_accounting_reversal_unique` ON `invoice_accounting_events` (`organization_id`,`reversal_of_event_id`);--> statement-breakpoint
CREATE INDEX `invoice_accounting_history_idx` ON `invoice_accounting_events` (`organization_id`,`invoice_id`,`event_date`);
--> statement-breakpoint
-- Recheck the complete posting at commit time. A stale UI/read cannot bypass
-- period locks, a competing allocation, bank source ownership or journal balance.
CREATE TRIGGER invoice_accounting_validate BEFORE INSERT ON invoice_accounting_events
BEGIN
  SELECT RAISE(ABORT,'INVOICE_ACCOUNTING_CHANGED') WHERE NOT EXISTS (
    SELECT 1 FROM customer_invoices i JOIN bookloq_settings s ON s.organization_id=i.organization_id
    JOIN bookloq_contacts c ON c.id=i.customer_id AND c.organization_id=i.organization_id
    WHERE i.id=NEW.invoice_id AND i.organization_id=NEW.organization_id AND i.demo_record=0
      AND s.status='active' AND s.data_mode='live' AND s.accounting_basis='accrual'
      AND i.currency=NEW.currency AND s.base_currency=NEW.currency
      AND i.total_cents=NEW.invoice_total_cents AND i.paid_cents=NEW.prior_paid_cents
      AND i.status NOT IN ('void','written_off') AND NEW.event_date>=i.invoice_date
      AND NEW.event_date>=COALESCE((SELECT MAX(e.event_date) FROM invoice_accounting_events e WHERE e.organization_id=NEW.organization_id AND e.invoice_id=NEW.invoice_id),i.invoice_date)
      AND (NEW.event_type<>'issue' OR (i.journal_entry_id IS NULL AND i.paid_cents=0 AND c.active=1 AND i.status IN ('draft','approved','sent','viewed','due','overdue','disputed')))
      AND (NEW.event_type='issue' OR (i.journal_entry_id=NEW.invoice_journal_entry_id AND EXISTS(SELECT 1 FROM invoice_accounting_events e JOIN journal_entries j ON j.id=e.journal_entry_id AND j.organization_id=e.organization_id WHERE e.organization_id=NEW.organization_id AND e.invoice_id=NEW.invoice_id AND e.event_type='issue' AND e.journal_entry_id=i.journal_entry_id AND j.status='posted')))
  );
  SELECT RAISE(ABORT,'INVOICE_ACCOUNTING_JOURNAL') WHERE NOT EXISTS (
    SELECT 1 FROM journal_entries j JOIN accounting_periods p ON p.id=j.period_id AND p.organization_id=j.organization_id
      WHERE j.id=NEW.journal_entry_id AND j.organization_id=NEW.organization_id
      AND p.status IN ('open','review') AND NEW.event_date BETWEEN p.start_date AND p.end_date
      AND j.status='posted' AND j.currency=NEW.currency AND j.entry_date=NEW.event_date
      AND j.idempotency_key=NEW.idempotency_key AND j.total_debit_cents=NEW.amount_cents AND j.total_credit_cents=NEW.amount_cents
      AND j.total_debit_cents=(SELECT SUM(l.debit_cents) FROM journal_lines l WHERE l.organization_id=j.organization_id AND l.journal_entry_id=j.id)
      AND j.total_credit_cents=(SELECT SUM(l.credit_cents) FROM journal_lines l WHERE l.organization_id=j.organization_id AND l.journal_entry_id=j.id)
      AND (SELECT COUNT(*) FROM journal_lines l WHERE l.organization_id=j.organization_id AND l.journal_entry_id=j.id)>=2
      AND NOT EXISTS(SELECT 1 FROM journal_lines l LEFT JOIN financial_accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id WHERE l.journal_entry_id=j.id AND (l.organization_id<>j.organization_id OR a.id IS NULL OR (NEW.event_type IN ('issue','payment') AND a.active<>1)))
      AND ((NEW.event_type='issue' AND j.source_type='customer_invoice' AND j.source_ref=NEW.invoice_id AND NEW.invoice_journal_entry_id=j.id)
        OR (NEW.event_type='payment' AND j.source_type='invoice_payment' AND j.source_ref=NEW.invoice_id)
        OR (NEW.event_type IN ('reverse_payment','void') AND j.source_type='reversal' AND j.reversal_of_entry_id IS NOT NULL))
  );
  SELECT RAISE(ABORT,'INVOICE_ACCOUNTING_ISSUE') WHERE NEW.event_type='issue' AND (
    NEW.amount_cents<>NEW.invoice_total_cents OR NEW.reversal_of_event_id IS NOT NULL
    OR NEW.cash_account_id IS NOT NULL OR NEW.source_transaction_id IS NOT NULL
    OR (SELECT COUNT(*) FROM invoice_accounting_events e WHERE e.organization_id=NEW.organization_id AND e.invoice_id=NEW.invoice_id AND e.event_type='issue')>0
    OR COALESCE((SELECT SUM(l.debit_cents) FROM journal_lines l JOIN financial_accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id WHERE l.journal_entry_id=NEW.journal_entry_id AND a.system_key='accounts_receivable' AND a.account_type='asset' AND a.normal_balance='debit'),0)<>NEW.amount_cents
    OR COALESCE((SELECT SUM(l.credit_cents) FROM journal_lines l JOIN financial_accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id WHERE l.journal_entry_id=NEW.journal_entry_id AND a.account_type='revenue' AND a.normal_balance='credit'),0)<>(SELECT subtotal_cents FROM customer_invoices WHERE id=NEW.invoice_id)
    OR COALESCE((SELECT SUM(l.credit_cents) FROM journal_lines l JOIN financial_accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id WHERE l.journal_entry_id=NEW.journal_entry_id AND a.account_type='liability' AND a.account_subtype='tax_payable' AND a.normal_balance='credit'),0)<>(SELECT tax_cents FROM customer_invoices WHERE id=NEW.invoice_id)
  );
  SELECT RAISE(ABORT,'INVOICE_ACCOUNTING_PAYMENT') WHERE NEW.event_type='payment' AND (
    NEW.reversal_of_event_id IS NOT NULL OR NEW.amount_cents>NEW.invoice_total_cents-NEW.prior_paid_cents
    OR NOT EXISTS(SELECT 1 FROM financial_accounts a LEFT JOIN bank_accounts b ON b.financial_account_id=a.id AND b.organization_id=a.organization_id WHERE a.id=NEW.cash_account_id AND a.organization_id=NEW.organization_id AND a.active=1 AND a.account_type='asset' AND a.normal_balance='debit' AND a.account_subtype IN ('cash','bank') AND (b.id IS NULL OR (b.currency=NEW.currency AND b.demo_record=0)))
    OR COALESCE((SELECT SUM(debit_cents) FROM journal_lines WHERE journal_entry_id=NEW.journal_entry_id AND account_id=NEW.cash_account_id),0)<>NEW.amount_cents
    OR COALESCE((SELECT SUM(l.credit_cents) FROM journal_lines l JOIN financial_accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id WHERE l.journal_entry_id=NEW.journal_entry_id AND a.system_key='accounts_receivable'),0)<>NEW.amount_cents
    OR EXISTS(SELECT 1 FROM invoice_accounting_events e WHERE e.organization_id=NEW.organization_id AND e.event_type='payment' AND e.cash_account_id=NEW.cash_account_id AND LOWER(e.reference)=LOWER(NEW.reference) AND NOT EXISTS(SELECT 1 FROM invoice_accounting_events r WHERE r.organization_id=e.organization_id AND r.reversal_of_event_id=e.id))
  );
  SELECT RAISE(ABORT,'INVOICE_ACCOUNTING_SOURCE') WHERE NEW.event_type='payment' AND NEW.source_transaction_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM financial_transactions t WHERE t.id=NEW.source_transaction_id AND t.organization_id=NEW.organization_id
      AND t.account_id=NEW.cash_account_id AND t.amount_cents=NEW.amount_cents AND t.currency=NEW.currency
      AND t.demo_record=0 AND t.source_state='posted' AND t.posting_date=NEW.event_date
      AND t.journal_entry_id IS NULL AND t.reconciliation_status<>'reconciled'
      AND (t.source_system<>'plaid' OR EXISTS(SELECT 1 FROM bank_accounts b JOIN integration_connections c ON c.organization_id=b.organization_id AND c.provider='plaid' AND c.external_account_ref=b.external_item_ref WHERE b.organization_id=t.organization_id AND b.financial_account_id=t.account_id AND b.provider='plaid' AND c.status='connected' AND c.data_promotion_status='approved' AND (c.sync_lease_owner IS NULL OR c.sync_lease_expires_at IS NULL OR c.sync_lease_expires_at<=CAST(strftime('%s','now') AS INTEGER))))
      AND NOT EXISTS(SELECT 1 FROM bookloq_transaction_matches m WHERE m.organization_id=t.organization_id AND m.transaction_id=t.id AND m.status='confirmed' AND (m.supplier_bill_id IS NOT NULL OR (m.customer_invoice_id IS NOT NULL AND m.customer_invoice_id<>NEW.invoice_id)))
  );
  SELECT RAISE(ABORT,'INVOICE_ACCOUNTING_CORRECTION') WHERE NEW.event_type IN ('reverse_payment','void') AND NOT EXISTS (
    SELECT 1 FROM invoice_accounting_events e JOIN journal_entries original ON original.id=e.journal_entry_id AND original.organization_id=e.organization_id
    JOIN journal_entries correction ON correction.id=NEW.journal_entry_id AND correction.organization_id=NEW.organization_id
    WHERE e.id=NEW.reversal_of_event_id AND e.organization_id=NEW.organization_id AND e.invoice_id=NEW.invoice_id
      AND e.event_type=CASE NEW.event_type WHEN 'void' THEN 'issue' ELSE 'payment' END
      AND e.amount_cents=NEW.amount_cents AND e.currency=NEW.currency AND original.status='posted'
      AND correction.reversal_of_entry_id=original.id AND correction.source_ref=original.id
      AND NEW.cash_account_id IS e.cash_account_id AND NEW.source_transaction_id IS e.source_transaction_id
      AND NOT EXISTS(SELECT 1 FROM journal_lines old LEFT JOIN journal_lines new ON new.journal_entry_id=correction.id AND new.line_number=old.line_number WHERE old.journal_entry_id=original.id AND (new.id IS NULL OR new.account_id<>old.account_id OR new.debit_cents<>old.credit_cents OR new.credit_cents<>old.debit_cents OR new.contact_id IS NOT old.contact_id OR new.location_ref<>old.location_ref))
      AND (SELECT COUNT(*) FROM journal_lines WHERE journal_entry_id=original.id)=(SELECT COUNT(*) FROM journal_lines WHERE journal_entry_id=correction.id)
      AND (NEW.event_type<>'reverse_payment' OR NEW.prior_paid_cents>=NEW.amount_cents)
      AND (e.source_transaction_id IS NULL OR EXISTS(SELECT 1 FROM financial_transactions t WHERE t.id=e.source_transaction_id AND t.organization_id=e.organization_id AND t.journal_entry_id=e.journal_entry_id AND t.reconciliation_status<>'reconciled'))
      AND (NEW.event_type<>'void' OR (NEW.prior_paid_cents=0 AND NOT EXISTS(SELECT 1 FROM invoice_accounting_events p WHERE p.organization_id=e.organization_id AND p.invoice_id=e.invoice_id AND p.event_type='payment' AND NOT EXISTS(SELECT 1 FROM invoice_accounting_events r WHERE r.organization_id=p.organization_id AND r.reversal_of_event_id=p.id))))
  );
END;
--> statement-breakpoint
CREATE TRIGGER invoice_accounting_apply AFTER INSERT ON invoice_accounting_events
BEGIN
  UPDATE customer_invoices SET journal_entry_id=NEW.journal_entry_id,
    status=CASE WHEN status IN ('draft','approved') THEN 'due' ELSE status END,updated_at=NEW.created_at
    WHERE id=NEW.invoice_id AND organization_id=NEW.organization_id AND NEW.event_type='issue';
  UPDATE customer_invoices SET paid_cents=paid_cents+NEW.amount_cents,
    status=CASE WHEN paid_cents+NEW.amount_cents=total_cents THEN 'paid' ELSE 'partially_paid' END,updated_at=NEW.created_at
    WHERE id=NEW.invoice_id AND organization_id=NEW.organization_id AND NEW.event_type='payment';
  UPDATE customer_invoices SET paid_cents=paid_cents-NEW.amount_cents,
    status=CASE WHEN paid_cents-NEW.amount_cents=0 THEN 'due' ELSE 'partially_paid' END,updated_at=NEW.created_at
    WHERE id=NEW.invoice_id AND organization_id=NEW.organization_id AND NEW.event_type='reverse_payment';
  UPDATE customer_invoices SET status='void',updated_at=NEW.created_at
    WHERE id=NEW.invoice_id AND organization_id=NEW.organization_id AND NEW.event_type='void';
  UPDATE financial_transactions SET journal_entry_id=NEW.journal_entry_id,updated_at=NEW.created_at
    WHERE id=NEW.source_transaction_id AND organization_id=NEW.organization_id AND NEW.event_type='payment';
  UPDATE financial_transactions SET journal_entry_id=NULL,updated_at=NEW.created_at
    WHERE id=NEW.source_transaction_id AND organization_id=NEW.organization_id AND NEW.event_type='reverse_payment';
  UPDATE journal_entries SET status='reversed',updated_at=NEW.created_at
    WHERE id=(SELECT journal_entry_id FROM invoice_accounting_events WHERE id=NEW.reversal_of_event_id AND organization_id=NEW.organization_id)
      AND organization_id=NEW.organization_id AND NEW.event_type IN ('void','reverse_payment');
END;
--> statement-breakpoint
CREATE TRIGGER invoice_accounting_events_immutable BEFORE UPDATE ON invoice_accounting_events
BEGIN SELECT RAISE(ABORT,'INVOICE_ACCOUNTING_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER invoice_accounting_events_retained BEFORE DELETE ON invoice_accounting_events
WHEN EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.organization_id)
BEGIN SELECT RAISE(ABORT,'INVOICE_ACCOUNTING_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER invoice_accounting_invoice_immutable BEFORE UPDATE OF customer_id,invoice_date,subtotal_cents,tax_cents,total_cents,currency,location_ref,demo_record ON customer_invoices
WHEN OLD.journal_entry_id IS NOT NULL AND (NEW.customer_id IS NOT OLD.customer_id OR NEW.invoice_date IS NOT OLD.invoice_date OR NEW.subtotal_cents IS NOT OLD.subtotal_cents OR NEW.tax_cents IS NOT OLD.tax_cents OR NEW.total_cents IS NOT OLD.total_cents OR NEW.currency IS NOT OLD.currency OR NEW.location_ref IS NOT OLD.location_ref OR NEW.demo_record IS NOT OLD.demo_record)
BEGIN SELECT RAISE(ABORT,'INVOICE_ACCOUNTING_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER invoice_accounting_lines_immutable_update BEFORE UPDATE ON journal_lines
WHEN EXISTS(SELECT 1 FROM invoice_accounting_events e WHERE e.journal_entry_id=OLD.journal_entry_id)
BEGIN SELECT RAISE(ABORT,'INVOICE_ACCOUNTING_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER invoice_accounting_lines_immutable_delete BEFORE DELETE ON journal_lines
WHEN EXISTS(SELECT 1 FROM invoice_accounting_events e JOIN workspaces w ON w.id=e.organization_id WHERE e.journal_entry_id=OLD.journal_entry_id)
BEGIN SELECT RAISE(ABORT,'INVOICE_ACCOUNTING_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER invoice_accounting_transaction_category BEFORE UPDATE OF category_account_id ON financial_transactions
WHEN OLD.journal_entry_id IS NOT NULL AND NEW.category_account_id IS NOT OLD.category_account_id
BEGIN SELECT RAISE(ABORT,'INVOICE_ACCOUNTING_TRANSACTION_POSTED'); END;
