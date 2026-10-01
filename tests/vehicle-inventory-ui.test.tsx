import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import InventoryVehicleWorkspace from "../app/vehicle-inventory-panel";

test("dealerships open basic vehicle inventory without mounting the product data view", () => {
  const html = renderToStaticMarkup(<InventoryVehicleWorkspace industry="Dealership" activeLocationId="location"><p>Product data view</p></InventoryVehicleWorkspace>);
  assert.match(html, /aria-pressed="true"[^>]*>Vehicles/);
  assert.match(html, /Vehicle records/);
  assert.match(html, /role="status"[^>]*>Loading vehicle records/);
  assert.doesNotMatch(html, /Product data view|Add vehicle|Export records/);
});

test("other industries keep the existing product inventory as their initial view", () => {
  const html = renderToStaticMarkup(<InventoryVehicleWorkspace industry="Retail" activeLocationId={null}><p>Product data view</p></InventoryVehicleWorkspace>);
  assert.match(html, /aria-pressed="true"[^>]*>Products/);
  assert.match(html, /Product data view/);
  assert.doesNotMatch(html, /Loading vehicle records/);
});
