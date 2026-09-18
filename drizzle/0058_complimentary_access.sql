CREATE TABLE complimentary_access (
  grant_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  auth_subject_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL,
  UNIQUE (organization_id),
  UNIQUE (user_id)
);

