-- Keep deletion and accounting approval mutually exclusive, including concurrent requests.
CREATE TRIGGER IF NOT EXISTS document_deletion_start_guard BEFORE UPDATE OF status ON workspace_documents
WHEN NEW.status='deletion_pending' AND OLD.status<>'deletion_pending'
BEGIN
 SELECT RAISE(ABORT,'RECORD_PROTECTED') WHERE OLD.status='approved';
 SELECT RAISE(ABORT,'DOCUMENT_PROCESSING_ACTIVE') WHERE json_extract(OLD.extracted_json,'$.processing.lock') IS NOT NULL;
 SELECT RAISE(ABORT,'DOCUMENT_LINKED') WHERE EXISTS(SELECT 1 FROM invoice_matches WHERE document_id=OLD.id) OR
 EXISTS(SELECT 1 FROM customer_invoices WHERE document_id=OLD.id) OR
 EXISTS(SELECT 1 FROM bank_statement_imports WHERE document_id=OLD.id) OR
 EXISTS(SELECT 1 FROM bookloq_transaction_matches WHERE document_id=OLD.id AND status='confirmed');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS document_deletion_state_guard BEFORE UPDATE ON workspace_documents
WHEN OLD.status='deletion_pending' AND (NEW.status<>'deletion_pending' OR NEW.security_state<>'quarantined')
BEGIN
 SELECT RAISE(ABORT,'DOCUMENT_DELETION_PENDING');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS document_accounting_retention_guard BEFORE DELETE ON workspace_documents
WHEN EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.organization_id)
 AND (OLD.status='approved' OR EXISTS(SELECT 1 FROM invoice_matches WHERE document_id=OLD.id) OR
 EXISTS(SELECT 1 FROM customer_invoices WHERE document_id=OLD.id) OR
 EXISTS(SELECT 1 FROM bank_statement_imports WHERE document_id=OLD.id) OR
 EXISTS(SELECT 1 FROM bookloq_transaction_matches WHERE document_id=OLD.id AND status='confirmed'))
BEGIN
 SELECT RAISE(ABORT,'DOCUMENT_LINKED');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS document_pending_invoice_match_insert BEFORE INSERT ON invoice_matches
WHEN NEW.document_id IS NOT NULL AND EXISTS(SELECT 1 FROM workspace_documents WHERE id=NEW.document_id AND status='deletion_pending')
BEGIN
 SELECT RAISE(ABORT,'DOCUMENT_DELETION_PENDING');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS document_pending_invoice_match_update BEFORE UPDATE OF document_id ON invoice_matches
WHEN NEW.document_id IS NOT NULL AND EXISTS(SELECT 1 FROM workspace_documents WHERE id=NEW.document_id AND status='deletion_pending')
BEGIN
 SELECT RAISE(ABORT,'DOCUMENT_DELETION_PENDING');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS document_pending_customer_invoice_insert BEFORE INSERT ON customer_invoices
WHEN NEW.document_id IS NOT NULL AND EXISTS(SELECT 1 FROM workspace_documents WHERE id=NEW.document_id AND status='deletion_pending')
BEGIN
 SELECT RAISE(ABORT,'DOCUMENT_DELETION_PENDING');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS document_pending_customer_invoice_update BEFORE UPDATE OF document_id ON customer_invoices
WHEN NEW.document_id IS NOT NULL AND EXISTS(SELECT 1 FROM workspace_documents WHERE id=NEW.document_id AND status='deletion_pending')
BEGIN
 SELECT RAISE(ABORT,'DOCUMENT_DELETION_PENDING');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS document_pending_transaction_match_insert BEFORE INSERT ON bookloq_transaction_matches
WHEN NEW.document_id IS NOT NULL AND NEW.status='confirmed' AND EXISTS(SELECT 1 FROM workspace_documents WHERE id=NEW.document_id AND status='deletion_pending')
BEGIN
 SELECT RAISE(ABORT,'DOCUMENT_DELETION_PENDING');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS document_pending_transaction_match_update BEFORE UPDATE OF document_id,status ON bookloq_transaction_matches
WHEN NEW.document_id IS NOT NULL AND NEW.status='confirmed' AND EXISTS(SELECT 1 FROM workspace_documents WHERE id=NEW.document_id AND status='deletion_pending')
BEGIN
 SELECT RAISE(ABORT,'DOCUMENT_DELETION_PENDING');
END;
