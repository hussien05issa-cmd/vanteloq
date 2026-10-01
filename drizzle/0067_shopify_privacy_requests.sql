CREATE TABLE shopify_privacy_requests (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('shopify','shopify-pos')),
  request_hash TEXT NOT NULL,
  request_ciphertext TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed')),
  received_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  last_exported_at INTEGER,
  last_export_complete INTEGER NOT NULL DEFAULT 0 CHECK(last_export_complete IN (0,1)),
  last_export_count INTEGER,
  completed_at INTEGER,
  completed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  completion_method TEXT CHECK(completion_method IN ('secure_delivery','no_retained_data')),
  completion_reference_hash TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX shopify_privacy_request_unique ON shopify_privacy_requests(organization_id,connection_id,request_hash);
--> statement-breakpoint
CREATE INDEX shopify_privacy_pending_idx ON shopify_privacy_requests(organization_id,status,due_at,id);
