CREATE TABLE advisor_preferences (
 organization_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 preferences_json TEXT NOT NULL CHECK(json_valid(preferences_json)), updated_at INTEGER NOT NULL,
 PRIMARY KEY(organization_id,user_id)
);
--> statement-breakpoint
CREATE TABLE advisor_requests (
 organization_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 turn_id TEXT NOT NULL, request_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('running','completed','failed')),
 conversation_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(organization_id,user_id,turn_id)
);
