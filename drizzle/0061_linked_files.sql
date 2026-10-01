CREATE TABLE cloud_file_connections (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auth_subject TEXT NOT NULL,
  provider TEXT NOT NULL CONSTRAINT cloud_file_connections_provider_check CHECK(provider IN ('google-files','microsoft-files')),
  state_hash TEXT NOT NULL CONSTRAINT cloud_file_connections_state_hash_unique UNIQUE,
  state_expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  verifier_ciphertext TEXT NOT NULL,
  token_ciphertext TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CONSTRAINT cloud_file_connections_status_check CHECK(status IN ('pending','connected','revoked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX cloud_file_connections_owner ON cloud_file_connections(organization_id,user_id,status);
--> statement-breakpoint
CREATE TABLE linked_files (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES cloud_file_connections(id) ON DELETE CASCADE,
  remote_id TEXT NOT NULL,
  sheet_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  kind TEXT NOT NULL CONSTRAINT linked_files_kind_check CHECK(kind IN ('sheet','document')),
  enabled INTEGER NOT NULL DEFAULT 1 CONSTRAINT linked_files_enabled_check CHECK(enabled IN (0,1)),
  revision TEXT,
  snapshot_ciphertext TEXT,
  document_id TEXT REFERENCES workspace_documents(id) ON DELETE SET NULL,
  last_checked_at INTEGER,
  last_changed_at INTEGER,
  error_code TEXT,
  lease TEXT,
  lease_expires_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CONSTRAINT linked_files_connection_remote_sheet_unique UNIQUE(connection_id,remote_id,sheet_name)
);
--> statement-breakpoint
CREATE INDEX linked_files_owner ON linked_files(organization_id,user_id);
