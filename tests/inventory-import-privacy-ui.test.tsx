import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { inventoryCostRequest } from "../app/commerce-intelligence-workspace";
import InventoryVehicleWorkspace, { previewVehicleImport, vehicleCsvImportRequest } from "../app/vehicle-inventory-panel";
import { dealershipImportRequest, previewDealershipImport } from "../app/dealership-workspace";
import RetailEvidenceSettings, { retailEvidenceRequest } from "../app/retail-evidence-settings";
import { DEALERSHIP_CSV_TEMPLATE } from "../domain/dealership";
import { VEHICLE_CSV_TEMPLATE } from "../domain/vehicles";
import { importPrivacyAcknowledgement } from "../domain/report-import-privacy";

const vehicleCsv = `${VEHICLE_CSV_TEMPLATE}vin,1HGCM82633A004352,2003,Honda,Accord,A-01,available,2026-09-10,CAD,,\n`;
const stockCsv = `${DEALERSHIP_CSV_TEMPLATE}vin,1HGCM82633A004352,2003,Honda,Accord,A-01,2026-09-01,consignment,offsite,blocked,\n`;
const location = { id: "location-a", name: "Test location", currency: "CAD" };

test("each outbound CSV path refuses an unchecked notice, including server previews", () => {
  assert.throws(() => inventoryCostRequest("csv", [{ sku: "A-01", unitCostCents: 100 }]), /Acknowledge/);
  for (const action of ["preview", "confirm"] as const) {
    assert.throws(() => vehicleCsvImportRequest(action, vehicleCsv, location.id, false, "server-check"), /Acknowledge/);
    assert.throws(() => dealershipImportRequest({ action, csv: stockCsv, locationId: location.id, fingerprint: "server-check" }), /Acknowledge/);
  }
  assert.throws(() => retailEvidenceRequest({ action: "save", csv: "reference,opening_units\nitem,10", reviewed: true }), /Acknowledge/);
});

test("accepted imports include the current notice and retain the reviewed payload and server fingerprint", () => {
  const entries = [{ sku: "A-01", unitCostCents: 100 }];
  assert.deepEqual(inventoryCostRequest("csv", entries, true), { source: "csv", entries, importPrivacyAcknowledgement: importPrivacyAcknowledgement() });
  for (const action of ["preview", "confirm"] as const) {
    const vehicle = vehicleCsvImportRequest(action, vehicleCsv, location.id, true, "server-check");
    assert.deepEqual(vehicle.importPrivacyAcknowledgement, importPrivacyAcknowledgement());
    assert.equal(vehicle.csv, vehicleCsv);
    assert.equal(vehicle.locationId, location.id);
    assert.equal(vehicle.fingerprint, action === "confirm" ? "server-check" : undefined);
    const stock = { action, csv: stockCsv, locationId: location.id, ...(action === "confirm" ? { fingerprint: "server-check", mutationKey: "same-retry-key" } : {}) };
    assert.deepEqual(dealershipImportRequest(stock, true), { ...stock, importPrivacyAcknowledgement: importPrivacyAcknowledgement() });
  }
  const supplemental = { action: "save", csv: "reviewed source records", reviewed: true, expectedVersion: 7, connectionId: "approved-source", outletRef: "outlet-a", from: "2026-09-01", to: "2026-09-30" };
  assert.deepEqual(retailEvidenceRequest(supplemental, true), { ...supplemental, importPrivacyAcknowledgement: importPrivacyAcknowledgement() });
});

test("local vehicle and stock previews need no notice or network and cannot authorize final import", () => {
  const vehicle = previewVehicleImport(vehicleCsv, location, false);
  assert.equal(vehicle.count, 1);
  assert.equal(vehicle.fingerprint, null);
  assert.equal(vehicle.entries[0].acquisitionCents, null);
  const stock = previewDealershipImport(stockCsv, "CAD");
  assert.equal(stock.count, 1);
  assert.equal(stock.fingerprint, null);
  assert.equal(stock.entries[0].askingCents, null);
  assert.throws(() => vehicleCsvImportRequest("confirm", vehicleCsv, location.id, true, vehicle.fingerprint), /Check this vehicle CSV/);
  assert.throws(() => dealershipImportRequest({ action: "confirm", csv: stockCsv, fingerprint: stock.fingerprint }, true), /Check this stock CSV/);
});

test("local previews preserve currency and hidden cost boundaries", () => {
  assert.throws(() => previewVehicleImport(vehicleCsv, { ...location, currency: "USD" }, true), /currency must match/);
  const costs = vehicleCsv.replace("CAD,,", "CAD,12000.00,0.00");
  assert.throws(() => previewVehicleImport(costs, location, false), /Inventory value permission/);
  assert.equal(previewVehicleImport(costs, location, true).entries[0].acquisitionCents, 1_200_000);
  assert.throws(() => previewDealershipImport(stockCsv.replace("consignment", "not-reviewed"), "CAD"), /ownership/i);
});

test("manual changes and reviewed deletion retain their controls without sending CSV", () => {
  const entries = [{ sku: "A-01", unitCostCents: 0 }];
  assert.deepEqual(inventoryCostRequest("manual", entries), { source: "manual", entries });
  const manual = { action: "update_stock", episodeId: "episode-a", expectedVersion: 7, availability: "available" };
  assert.deepEqual(dealershipImportRequest(manual), manual);
  const deletion = { action: "delete", expectedVersion: 7, reviewed: true, connectionId: "approved-source", csv: "private records", importPrivacyAcknowledgement: importPrivacyAcknowledgement() };
  assert.deepEqual(retailEvidenceRequest(deletion), { action: "delete", expectedVersion: 7, reviewed: true, connectionId: "approved-source" });
  assert.equal(deletion.csv, "private records", "request construction must not change the retained editor draft");
});

test("supplemental import starts with privacy and evidence review unchecked", () => {
  const html = renderToStaticMarkup(<RetailEvidenceSettings from="2026-09-01" to="2026-09-30" locationId={null} access={{ inventory: true, labour: false, customers: false }} onSaved={() => {}} onClose={() => {}}/>);
  assert.match(html, /Import supplemental CSV/);
  assert.equal((html.match(/type="checkbox"/g) || []).length, 2);
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /<button type="submit" disabled="">Import supplemental CSV/);
});

test("a cost import target can open product inventory even for dealerships", () => {
  const html = renderToStaticMarkup(<InventoryVehicleWorkspace industry="Dealership" initialView="products" activeLocationId="location-a"><p>Product cost import</p></InventoryVehicleWorkspace>);
  assert.match(html, /aria-pressed="true"[^>]*>Products/);
  assert.match(html, /Product cost import/);
  assert.doesNotMatch(html, /Loading vehicle records/);
});
