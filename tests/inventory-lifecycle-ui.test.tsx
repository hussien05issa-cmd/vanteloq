import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InventoryLifecycleCoverageWarning, InventoryLifecycleFefo, InventoryLifecycleLotEmpty, InventoryLifecyclePosSkuCount, InventoryLifecycleSummary, type InventoryLifecyclePayload } from "../app/inventory-lifecycle-workspace";

const coverage = (status: "complete" | "partial") => ({ status, loadedCount: status === "partial" ? 1000 : 2, matchingCountAtLeast: status === "partial" ? 1001 : 2 });
const summary: InventoryLifecyclePayload["summary"] = { totalLots: 2, trackedLots: 2, totalUnits: 8, costAtRiskCents: 1200, costRiskKnownLots: 2, riskCounts: { healthy: 1, monitor: 1, at_risk: 0, urgent: 0, expired: 0, untracked: 0 }, posSkus: 4, posUnits: 20, lowStockSkus: 1 };
const source = (lots: "complete" | "partial", pos: "complete" | "partial"): InventoryLifecyclePayload["source"] => ({ generatedAt: "2026-10-11T12:00:00Z", calculation: "Fictional source calculation. Some selected inventory records exceed the safe loaded selection; review complete coverage.", coverage: { status: lots === "partial" || pos === "partial" ? "partial" : "complete", limit: 1000, reason: lots === "partial" || pos === "partial" ? "Selection incomplete" : null, lots: coverage(lots), posBalances: coverage(pos) } });
const summaryMarkup = (lots: "complete" | "partial", pos: "complete" | "partial", values = summary) => renderToStaticMarkup(<InventoryLifecycleSummary data={{ summary: values, source: source(lots, pos) }}/>);

test("partial lots withhold their total while independently complete POS numbers remain readable", () => {
  const html = summaryMarkup("partial", "complete", { ...summary, totalLots: null, trackedLots: null, totalUnits: null, costAtRiskCents: null, costRiskKnownLots: null, riskCounts: null });
  assert.match(html, /POS SKUS<\/small><b>4<\/b>/);
  assert.match(html, /POS UNITS ON HAND<\/small><b>20<\/b>/);
  assert.match(html, /LOT RECORDS<\/small><b>Not determined<\/b>/);
  assert.doesNotMatch(html, /LOT RECORDS<\/small><b>0/);
});

test("partial POS coverage withholds each POS aggregate without suppressing complete lot totals", () => {
  const values = { ...summary, posSkus: null, posUnits: null, lowStockSkus: null };
  const html = summaryMarkup("complete", "partial", values);
  assert.equal((html.match(/Not determined/g) ?? []).length, 3);
  assert.match(html, /LOT RECORDS<\/small><b>2<\/b>/);
  const label = renderToStaticMarkup(<InventoryLifecyclePosSkuCount data={{ summary: values, source: source("complete", "partial") }}/>);
  assert.match(label, /SKU total not determined/);
  assert.doesNotMatch(label, /0 SKUs|1000 SKUs/);
});

test("coverage prevents a partial payload from promoting supplied subset numbers into complete totals", () => {
  const html = summaryMarkup("partial", "partial");
  assert.equal((html.match(/Not determined/g) ?? []).length, 4);
  assert.doesNotMatch(html, /<b>4<\/b>|<b>20<\/b>|<b>2<\/b>/);
});

test("verified complete zero remains zero while null remains not determined", () => {
  const html = summaryMarkup("complete", "complete", { ...summary, totalLots: 0, posSkus: 0, posUnits: 0, lowStockSkus: null });
  assert.match(html, /POS SKUS<\/small><b>0<\/b>/);
  assert.match(html, /POS UNITS ON HAND<\/small><b>0<\/b>/);
  assert.match(html, /LOT RECORDS<\/small><b>0<\/b>/);
  assert.match(html, /AT OR BELOW REORDER<\/small><b>Not determined<\/b>/);
});

test("partial coverage exposes the exact server calculation warning above the records", () => {
  const html = renderToStaticMarkup(<InventoryLifecycleCoverageWarning source={source("partial", "complete")}/>);
  assert.match(html, /role="status"/);
  assert.match(html, /Incomplete inventory source coverage/);
  assert.match(html, /Fictional source calculation/);
  assert.match(html, /Individual loaded records remain available/);
  assert.equal(renderToStaticMarkup(<InventoryLifecycleCoverageWarning source={source("complete", "complete")}/>), "");
});

test("partial FEFO is withheld even if a malformed payload supplies a ranked subset", () => {
  const unsafeSubset = [{ id: "subset-1", fefoRank: 1, productName: "Subset product", sku: "SKU-1", locationRef: "MAIN", assessment: { trackedDate: "2026-10-12" } }] as InventoryLifecyclePayload["fefo"];
  const html = renderToStaticMarkup(<InventoryLifecycleFefo lots={unsafeSubset} coverage={coverage("partial")}/>);
  assert.match(html, /Pick order not determined/);
  assert.match(html, /lot selection is incomplete/);
  assert.doesNotMatch(html, /No active lot is available|Subset product|<i>1<\/i>/);
});

test("incomplete loaded lots and verified empty lots have distinct explanations", () => {
  const partial = renderToStaticMarkup(<InventoryLifecycleLotEmpty coverage={coverage("partial")}/>);
  const complete = renderToStaticMarkup(<InventoryLifecycleLotEmpty coverage={coverage("complete")}/>);
  assert.match(partial, /No matching lots in the loaded records/);
  assert.match(partial, /Only part of the selected inventory is loaded/);
  assert.doesNotMatch(partial, /No inventory lots in this view|Add a lot/);
  assert.match(complete, /No inventory lots in this view/);
  const verifiedEmpty = renderToStaticMarkup(<InventoryLifecycleFefo lots={[]} coverage={coverage("complete")}/>);
  assert.match(verifiedEmpty, /No active lot is available to rank/);
  assert.doesNotMatch(verifiedEmpty, /Pick order not determined/);
});

test("legacy responses keep recorded display while missing legacy values never become zero", () => {
  const legacySource = { calculation: "Recorded source calculation", generatedAt: "2026-10-11T12:00:00Z" };
  const html = renderToStaticMarkup(<InventoryLifecycleSummary data={{ summary: { ...summary, posUnits: null }, source: legacySource }}/>);
  assert.match(html, /POS SKUS<\/small><b>4<\/b>/);
  assert.match(html, /POS UNITS ON HAND<\/small><b>Not determined<\/b>/);
  assert.equal(renderToStaticMarkup(<InventoryLifecycleCoverageWarning source={legacySource}/>), "");
});
