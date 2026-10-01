CREATE TABLE inventory_vehicles (
 id TEXT PRIMARY KEY NOT NULL,
 organization_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 location_id TEXT NOT NULL REFERENCES organization_locations(id) ON DELETE CASCADE,
 identifier_kind TEXT NOT NULL CHECK(identifier_kind IN ('vin','legacy')),
 identifier TEXT NOT NULL,
 model_year INTEGER NOT NULL CHECK(model_year BETWEEN 1886 AND 2200),
 make TEXT NOT NULL, model TEXT NOT NULL, stock_number TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('available','reconditioning','reserved','sold','archived')),
 acquired_date TEXT NOT NULL, currency TEXT NOT NULL CHECK(length(currency)=3),
 acquisition_cents INTEGER CHECK(acquisition_cents IS NULL OR (typeof(acquisition_cents)='integer' AND acquisition_cents BETWEEN 0 AND 1000000000)),
 reconditioning_cents INTEGER CHECK(reconditioning_cents IS NULL OR (typeof(reconditioning_cents)='integer' AND reconditioning_cents BETWEEN 0 AND 1000000000)),
 source TEXT NOT NULL CHECK(source IN ('manual','csv')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
 created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 CHECK((identifier_kind='vin' AND length(identifier)=17 AND identifier NOT GLOB '*[^A-HJ-NPR-Z0-9]*') OR (identifier_kind='legacy' AND model_year<1981)),
 UNIQUE(organization_id,identifier), UNIQUE(organization_id,stock_number)
);
--> statement-breakpoint
CREATE INDEX inventory_vehicles_scope_idx ON inventory_vehicles(organization_id,location_id,updated_at,id);
--> statement-breakpoint
CREATE TRIGGER inventory_vehicles_location_insert BEFORE INSERT ON inventory_vehicles
WHEN NOT EXISTS (SELECT 1 FROM organization_locations WHERE id=NEW.location_id AND organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'vehicle location mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER inventory_vehicles_location_update BEFORE UPDATE OF location_id,organization_id ON inventory_vehicles
WHEN NOT EXISTS (SELECT 1 FROM organization_locations WHERE id=NEW.location_id AND organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'vehicle location mismatch'); END;
