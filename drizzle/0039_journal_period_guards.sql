-- Enforce period locks at the write boundary, not only in an earlier API read.
CREATE TRIGGER journal_entries_open_period_insert
BEFORE INSERT ON journal_entries
WHEN NEW.status IN ('posted', 'reversed')
  AND NOT EXISTS (
    SELECT 1 FROM accounting_periods p
    WHERE p.id = NEW.period_id AND p.organization_id = NEW.organization_id
      AND p.status IN ('open', 'review') AND p.start_date <= NEW.entry_date AND p.end_date >= NEW.entry_date
  )
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNTING_PERIOD_UNAVAILABLE');
END;
--> statement-breakpoint
CREATE TRIGGER journal_entries_open_period_post
BEFORE UPDATE OF status, period_id, entry_date ON journal_entries
WHEN NEW.status IN ('posted', 'reversed')
  AND (OLD.status NOT IN ('posted', 'reversed')
    OR NEW.period_id IS NOT OLD.period_id OR NEW.entry_date IS NOT OLD.entry_date)
  AND NOT EXISTS (
    SELECT 1 FROM accounting_periods p
    WHERE p.id = NEW.period_id AND p.organization_id = NEW.organization_id
      AND p.status IN ('open', 'review') AND p.start_date <= NEW.entry_date AND p.end_date >= NEW.entry_date
  )
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNTING_PERIOD_UNAVAILABLE');
END;
