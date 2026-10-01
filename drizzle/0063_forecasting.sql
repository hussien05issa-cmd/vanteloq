CREATE TABLE forecasting_settings (
 organization_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 location_id TEXT NOT NULL REFERENCES organization_locations(id) ON DELETE CASCADE,
 settings_json TEXT NOT NULL CHECK(json_valid(settings_json)),
 updated_by TEXT REFERENCES users(id) ON DELETE SET NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY (organization_id, location_id)
);
--> statement-breakpoint
CREATE TABLE forecasting_runs (
 id TEXT PRIMARY KEY NOT NULL,
 organization_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 issued_at TEXT NOT NULL, horizon INTEGER NOT NULL CHECK(horizon IN (7,28)),
 model_version TEXT NOT NULL, input_hash TEXT NOT NULL,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 report_json TEXT NOT NULL CHECK(json_valid(report_json))
);
--> statement-breakpoint
CREATE INDEX forecasting_runs_owner_idx ON forecasting_runs(organization_id, created_by, issued_at);
--> statement-breakpoint
CREATE TABLE forecasting_views (
 organization_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 preferences_json TEXT NOT NULL CHECK(json_valid(preferences_json)), updated_at INTEGER NOT NULL,
 PRIMARY KEY(organization_id,user_id)
);
