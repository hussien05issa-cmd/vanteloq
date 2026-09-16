CREATE TABLE document_email_aliases (
  organization_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  alias TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
  authorized_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auth_subject TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consented_at INTEGER NOT NULL,
  generation TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE document_email_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  alias_generation TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('processing','complete')),
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX document_email_delivery_org_time ON document_email_deliveries(organization_id,created_at);
--> statement-breakpoint
CREATE TABLE document_email_sources (
  delivery_id TEXT NOT NULL REFERENCES document_email_deliveries(id) ON DELETE CASCADE,
  attachment_index INTEGER NOT NULL CHECK(attachment_index>=0 AND attachment_index<5),
  organization_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES workspace_documents(id) ON DELETE SET NULL,
  sender_unverified TEXT NOT NULL,
  authorized_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(delivery_id,attachment_index)
);
--> statement-breakpoint
CREATE TRIGGER document_email_sources_tenant BEFORE INSERT ON document_email_sources
WHEN NOT EXISTS(SELECT 1 FROM document_email_deliveries WHERE id=NEW.delivery_id AND organization_id=NEW.organization_id)
  OR (NEW.document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workspace_documents WHERE id=NEW.document_id AND organization_id=NEW.organization_id))
BEGIN SELECT RAISE(ABORT,'EMAIL_SOURCE_TENANT_MISMATCH'); END;
--> statement-breakpoint
CREATE TRIGGER document_email_sources_delete BEFORE DELETE ON workspace_documents
BEGIN UPDATE document_email_sources SET sender_unverified='',document_id=NULL WHERE document_id=OLD.id AND organization_id=OLD.organization_id; END;
--> statement-breakpoint
-- Deliberately no cascading foreign key: failed private objects must remain disposable after account deletion.
CREATE TABLE document_ingest_intents (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  sha256_hex TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN('writing','cleanup')),
  created_at INTEGER NOT NULL,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX document_ingest_org_hash ON document_ingest_intents(organization_id,sha256_hex);
--> statement-breakpoint
CREATE INDEX document_ingest_cleanup_due ON document_ingest_intents(state,lease_until,created_at);
