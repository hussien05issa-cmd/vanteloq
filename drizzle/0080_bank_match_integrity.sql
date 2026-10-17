-- A match may commit after a reversal route's eligibility read. Protect the
-- posted journal at commit time until bank review records an audited unmatch.
CREATE TRIGGER bank_matched_journal_status_guard BEFORE UPDATE OF status ON journal_entries
WHEN NEW.status<>OLD.status AND EXISTS (
  SELECT 1 FROM bank_accounting_events e
  WHERE e.organization_id=OLD.organization_id AND e.journal_entry_id=OLD.id AND e.event_type='match'
    AND NOT EXISTS(SELECT 1 FROM bank_accounting_events r WHERE r.organization_id=e.organization_id AND r.reversal_of_event_id=e.id)
)
BEGIN SELECT RAISE(ABORT,'BANK_JOURNAL_RETAINED'); END;
--> statement-breakpoint
-- Invoice/bill evidence cannot reallocate an independently posted bank entry.
-- The same invoice's active source-linked payment is already compatible.
CREATE TRIGGER supporting_match_accounting_insert BEFORE INSERT ON bookloq_transaction_matches
WHEN NEW.status='confirmed' AND (NEW.customer_invoice_id IS NOT NULL OR NEW.supplier_bill_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT,'SUPPORTING_MATCH_ACCOUNTING') WHERE NOT EXISTS (
    SELECT 1 FROM financial_transactions t
    WHERE t.organization_id=NEW.organization_id AND t.id=NEW.transaction_id
      AND (t.journal_entry_id IS NULL OR (NEW.customer_invoice_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM invoice_accounting_events e JOIN journal_entries j ON j.id=e.journal_entry_id AND j.organization_id=e.organization_id
        WHERE e.organization_id=t.organization_id AND e.invoice_id=NEW.customer_invoice_id AND e.source_transaction_id=t.id
          AND e.journal_entry_id=t.journal_entry_id AND e.event_type='payment' AND j.status='posted'
          AND NOT EXISTS(SELECT 1 FROM invoice_accounting_events r WHERE r.organization_id=e.organization_id AND r.reversal_of_event_id=e.id)
      )))
  );
END;
--> statement-breakpoint
CREATE TRIGGER supporting_match_accounting_update BEFORE UPDATE ON bookloq_transaction_matches
WHEN NEW.status='confirmed' AND (NEW.customer_invoice_id IS NOT NULL OR NEW.supplier_bill_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT,'SUPPORTING_MATCH_ACCOUNTING') WHERE NOT EXISTS (
    SELECT 1 FROM financial_transactions t
    WHERE t.organization_id=NEW.organization_id AND t.id=NEW.transaction_id
      AND (t.journal_entry_id IS NULL OR (NEW.customer_invoice_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM invoice_accounting_events e JOIN journal_entries j ON j.id=e.journal_entry_id AND j.organization_id=e.organization_id
        WHERE e.organization_id=t.organization_id AND e.invoice_id=NEW.customer_invoice_id AND e.source_transaction_id=t.id
          AND e.journal_entry_id=t.journal_entry_id AND e.event_type='payment' AND j.status='posted'
          AND NOT EXISTS(SELECT 1 FROM invoice_accounting_events r WHERE r.organization_id=e.organization_id AND r.reversal_of_event_id=e.id)
      )))
  );
END;
