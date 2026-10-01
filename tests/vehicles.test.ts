import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { parseVehicleCsv, validateVehicle, vehicleAmountToCents, vehicleExportCsv, VEHICLE_CSV_TEMPLATE, type VehicleRecord } from "../domain/vehicles";
import { industryKpiRecommendation } from "../domain/industry-kpis";

const now = new Date("2026-10-01T12:00:00Z");
const valid = { identifierKind: "vin", identifier: "1HGCM82633A004352", year: 2003, make: "Honda", model: "Accord", stockNumber: "A-01", status: "available", acquiredDate: "2026-09-10", currency: "CAD", acquisitionCents: null, reconditioningCents: 0 };

test("vehicle validation normalizes identifiers and keeps unknown costs distinct from verified zero", () => {
  const row = validateVehicle({ ...valid, identifier: " 1hgcm82633a004352 ", stockNumber: " a-01 " }, now);
  assert.equal(row.identifier, valid.identifier); assert.equal(row.stockNumber, "A-01");
  assert.equal(row.acquisitionCents, null); assert.equal(row.reconditioningCents, 0);
  for (const identifier of ["1HGCM82633A00435I", "1HGCM82633A00435O", "1HGCM82633A00435Q", "1HG CM82633A004352", "1HGCM82633A00435", "=1HGCM82633A004352"]) {
    assert.throws(() => validateVehicle({ ...valid, identifier }, now), /VIN/);
  }
  for (const cost of [-1, 1.1, Number.MAX_SAFE_INTEGER, "100", Infinity]) assert.throws(() => validateVehicle({ ...valid, acquisitionCents: cost }, now), /cost/);
  assert.throws(() => validateVehicle({ ...valid, acquiredDate: "2026-02-30" }, now), /date/);
  assert.throws(() => validateVehicle({ ...valid, year: 2029 }, now), /year/);
  assert.throws(() => validateVehicle({ ...valid, status: "financed" }, now), /status/);
});

test("legacy identifiers require an explicit kind and a pre-1981 model year", () => {
  const row = validateVehicle({ ...valid, identifierKind: "legacy", year: 1967, identifier: " ab-12.34 " }, now);
  assert.equal(row.identifier, "AB-12.34");
  assert.throws(() => validateVehicle({ ...valid, identifierKind: "legacy", year: 1981, identifier: "AB-12" }, now), /before 1981/);
  assert.throws(() => validateVehicle({ ...valid, identifier: "AB-12", year: 1967 }, now), /17/);
});

test("vehicle CSV preserves decimal cents and quoted values without guessing column mappings", () => {
  assert.equal(vehicleAmountToCents("12345.67"), 1234567);
  assert.equal(vehicleAmountToCents("0.01"), 1); assert.equal(vehicleAmountToCents(""), null);
  for (const bad of ["1.001", "1,000", "1e2", "-1", "$1", "NaN"]) assert.throws(() => vehicleAmountToCents(bad));
  const csv = `${VEHICLE_CSV_TEMPLATE}vin,1HGCM82633A004352,2003,Honda,"Accord, LX",A-01,available,2026-09-10,CAD,12345.67,0.00\n`;
  const [row] = parseVehicleCsv(csv, now);
  assert.equal(row.model, "Accord, LX"); assert.equal(row.acquisitionCents, 1234567); assert.equal(row.reconditioningCents, 0);
  assert.throws(() => parseVehicleCsv(csv + csv.split("\n")[1], now), /repeated/);
  assert.throws(() => parseVehicleCsv(csv.replace("identifier_kind", "unknown"), now), /headings/);
  assert.throws(() => parseVehicleCsv(csv.replace('"Accord, LX"', '"Accord, LX'), now), /quoted/);
  assert.throws(() => parseVehicleCsv(VEHICLE_CSV_TEMPLATE + Array(101).fill(csv.split("\n")[1]).join("\n"), now), /100 vehicle/);
});

test("vehicle exports preserve provenance, neutralize formulas and omit restricted cost columns", () => {
  const row: VehicleRecord = { ...validateVehicle(valid, now), id: "one", locationId: "location-one", locationName: "Main", make: "=HYPERLINK(\"https://example.invalid\")", source: "csv", version: 2, createdAt: now.valueOf(), updatedAt: now.valueOf() };
  const exported = vehicleExportCsv([row], true);
  assert.match(exported, /source,version,created_at,updated_at/);
  assert.match(exported, /'=HYPERLINK/); assert.match(exported, /,0\.00,one,/);
  const redacted = vehicleExportCsv([row], false);
  assert.doesNotMatch(redacted, /acquisition_amount|reconditioning_amount|,0\.00,/);
  assert.match(redacted, /location-one,Main,csv,2/);
});

test("vehicle storage enforces tenant locations, duplicates, versioning and deletion cleanup", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE workspaces(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE organization_locations(id TEXT PRIMARY KEY,organization_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE); INSERT INTO workspaces VALUES('a'),('b'); INSERT INTO users VALUES('user'); INSERT INTO organization_locations VALUES('a-loc','a'),('b-loc','b');");
    db.exec(readFileSync(new URL("../drizzle/0066_vehicle_inventory.sql", import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
    const insert = db.prepare("INSERT INTO inventory_vehicles(id,organization_id,location_id,identifier_kind,identifier,model_year,make,model,stock_number,status,acquired_date,currency,source,created_by,created_at,updated_at) VALUES(?,?,?,'vin',?,2003,'Honda','Accord',?,'available','2026-09-10','CAD','manual','user',1,1)");
    insert.run("one", "a", "a-loc", valid.identifier, "A-01");
    assert.throws(() => insert.run("bad", "a", "b-loc", "1HGCM82633A004353", "A-02"), /location mismatch/);
    assert.throws(() => insert.run("dup", "a", "a-loc", valid.identifier, "A-02"), /UNIQUE/);
    insert.run("other", "b", "b-loc", valid.identifier, "A-01");
    const update = db.prepare("UPDATE inventory_vehicles SET status='reserved',version=version+1 WHERE id=? AND organization_id=? AND version=?");
    assert.equal(update.run("one", "b", 1).changes, 0);
    assert.equal(update.run("one", "a", 1).changes, 1);
    assert.equal(update.run("one", "a", 1).changes, 0);
    db.exec("DELETE FROM users WHERE id='user'");
    assert.equal(db.prepare("SELECT created_by FROM inventory_vehicles WHERE id='one'").get()?.created_by, null);
    db.exec("DELETE FROM organization_locations WHERE id='a-loc'");
    assert.equal(db.prepare("SELECT count(*) count FROM inventory_vehicles WHERE organization_id='a'").get()?.count, 0);
    db.exec("DELETE FROM workspaces WHERE id='b'");
    assert.equal(db.prepare("SELECT count(*) count FROM inventory_vehicles").get()?.count, 0);
  } finally { db.close(); }
});

test("dealership guidance keeps vehicle status separate from revenue and ledger calculations", () => {
  const guide = industryKpiRecommendation("Dealership");
  assert.equal(guide.industry, "Dealership"); assert.match(guide.summary, /do not create sales or accounting entries/);
  assert.ok(guide.nextMeasures.some(measure => /do not yet calculate/.test(measure.requiredEvidence)));
});
