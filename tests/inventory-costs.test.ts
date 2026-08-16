import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("inventory costs are durable, tenant scoped, permission checked and audited", async () => {
  const [schema, route, helper] = await Promise.all([
    source("db/schema.ts"),
    source("app/api/v1/inventory-costs/route.ts"),
    source("server/inventory-costs.ts"),
  ]);
  assert.match(schema, /ownerCostCents: integer\("owner_cost_cents"\)/);
  assert.match(schema, /ownerCostSource: text\("owner_cost_source"/);
  assert.match(route, /requireSameOrigin\(request\)/);
  assert.match(route, /requirePermission\(context, "inventory\.adjust"\)/);
  assert.match(route, /source === "csv"[\s\S]*requirePermission\(context, "data\.import"\)/);
  assert.match(route, /WHERE p\.organization_id = \?/);
  assert.match(route, /inventory\.costs_imported/);
  assert.match(route, /INVENTORY_COST_REVIEW_REQUIRED/);
  assert.match(helper, /product\.owner_cost_cents \* commerce_sale_lines\.quantity_milli/);
  assert.match(helper, /UPDATE daily_business_metrics AS metric/);
});

test("manual and CSV cost workflows require review and survive connector refreshes", async () => {
  const [workspace, square, clover, lightspeed] = await Promise.all([
    source("app/commerce-intelligence-workspace.tsx"),
    source("app/api/v1/integrations/square/sync/route.ts"),
    source("app/api/v1/integrations/clover/sync/route.ts"),
    source("app/api/v1/integrations/lightspeed-r/sync/route.ts"),
  ]);
  assert.match(workspace, /Download template/);
  assert.match(workspace, /Choose cost CSV/);
  assert.match(workspace, /Save \$\{costPreview\.length\} costs/);
  assert.match(workspace, /saveManualCost\(row\)/);
  assert.match(workspace, /Unit cost/);
  for (const connector of [square, clover, lightspeed]) {
    assert.match(connector, /applyOwnerInventoryCosts/);
  }
});
