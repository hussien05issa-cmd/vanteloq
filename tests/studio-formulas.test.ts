import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import StudioSheets from "../app/studio-sheets.tsx";
import { studioSalesSummary, type StudioExecutiveReview } from "../domain/data-studio.ts";
import {
  createStudioSheetDraft, evaluateStudioSheet, formatStudioDecimal, validateStudioSheetDraft,
  type StudioSheetDraft,
} from "../domain/studio-formulas.ts";

function review(): StudioExecutiveReview {
  const rows = [{ id: "one", businessDate: "2026-10-01", locationRef: "shop", sourceKind: "owner_summary" as const,
    netSalesCents: 10001, costOfGoodsCents: 6000, transactionCount: 4, unitsSold: 5 }];
  return {
    version: "studio-v1",
    metadata: { organizationId: "org", currency: "CAD", timeZone: "UTC", from: "2026-10-01", to: "2026-10-01",
      locationIds: ["shop"], generatedUtc: "2026-10-01T00:00:00.000Z", extractionUtc: "2026-10-01T00:00:00.000Z",
      specificationHash: "spec", snapshotHash: "current", consistency: "component_read_transactions", calculationVersion: "v1",
      dataMode: "stored_records", rowCount: 1, limit: 2000, truncated: false, canExport: true,
      sourceAuthority: "Permitted records", providerHistoryCertified: false, recordedDayCount: 1, calendarDayCount: 1, latestRecordUpdateUtc: null },
    sales: { state: "recorded", reason: null, rows, summary: studioSalesSummary(rows) },
    margin: { state: "recorded", reason: null }, inventory: { state: "unavailable", reason: "No inventory" },
    cash: { state: "unavailable", reason: "No cash" }, limitations: [],
  };
}

function sheet(inputs: string[]): StudioSheetDraft {
  return { version: "studio-sheet-v1", title: "Test assumptions", cells: inputs.map((input, i) => ({
    address: `A${i + 1}`, name: `Assumption ${i + 1}`, input, format: "number",
  })) };
}
const result = (input: string) => evaluateStudioSheet(sheet([input]), review()).cells.A1;
function value(input: string, expected: string) { assert.deepEqual(result(input), { state: "value", value: expected }); }

test("decimal arithmetic preserves cents, signs and large financial values without binary rounding", () => {
  value("=0.1+0.2", "0.3"); value("=1.25-2", "-0.75"); value("=0.07*0.03", "0.0021");
  value("=90071992547409.91+0.01", "90071992547409.92"); value("=-(2+3)*4", "-20");
  value("=1/8", "0.125"); value("=0.03/0.2", "0.15"); value("=10/0.1", "100");
});
test("nonterminating and over-scale calculations have explicit errors instead of rounded values", () => {
  assert.equal(result("=1/3").state, "error");
  assert.equal(result("=1/3").code, "PRECISION");
  assert.equal(result("=0.000000000001*0.1").code, "PRECISION");
  assert.equal(result("=1/0").code, "DIV_ZERO");
  assert.equal(result("=9999999999999999999999999999999999999999*10").code, "LIMIT");
});
test("source references preserve cents and missing or restricted states even if stale fields exist", () => {
  value("=NET_SALES-GROSS_PROFIT", "60"); value("=TRANSACTIONS", "4");
  const restricted = review(); restricted.margin = { state: "restricted", reason: "No cost permission" };
  const output = evaluateStudioSheet(sheet(["=GROSS_PROFIT", "=NET_SALES-GROSS_PROFIT", "=NET_SALES"]), restricted);
  assert.equal(output.cells.A1.code, "RESTRICTED"); assert.equal(output.cells.A2.code, "RESTRICTED");
  assert.deepEqual(output.cells.A3, { state: "value", value: "100.01" });
  const missing = review(); missing.sales.summary!.grossProfitCents = null;
  assert.equal(evaluateStudioSheet(sheet(["=GROSS_PROFIT"]), missing).cells.A1.code, "MISSING_SOURCE");
  missing.sales.state = "unavailable";
  assert.equal(evaluateStudioSheet(sheet(["=NET_SALES"]), missing).cells.A1.code, "MISSING_SOURCE");
});
test("cell dependencies report cycles, missing cells and empty inputs without treating them as zero", () => {
  const cycle = evaluateStudioSheet(sheet(["=A2+1", "=A1+1", "=A1"]), review());
  assert.equal(cycle.cells.A1.code, "CYCLE"); assert.equal(cycle.cells.A2.code, "CYCLE"); assert.equal(cycle.cells.A3.code, "CYCLE");
  assert.equal(result("=Z99+1").code, "REFERENCE"); assert.equal(result("").code, "EMPTY");
  const empty = evaluateStudioSheet(sheet(["", "=A1+2"]), review()); assert.equal(empty.cells.A2.code, "EMPTY");
});
test("SUM supports numeric expressions and bounded declared cell ranges; IF evaluates only its chosen branch", () => {
  const output = evaluateStudioSheet(sheet(["0.1", "0.2", "=SUM(A1:A2,0.3)", "=IF(A3>=0.6,A3,1/0)", "=IF(0,1/0,4)"]), review());
  assert.deepEqual(output.cells.A3, { state: "value", value: "0.6" });
  assert.deepEqual(output.cells.A4, { state: "value", value: "0.6" });
  assert.deepEqual(output.cells.A5, { state: "value", value: "4" });
  assert.equal(result("=SUM(A2:A3)").code, "REFERENCE"); assert.equal(result("=IF(1,2)").code, "SYNTAX");
  assert.equal(result("=SUM(A1:Z99)").code, "LIMIT");
});
test("the parser rejects executable text, unsupported functions, external references and scientific notation", () => {
  for (const input of ["=globalThis.process.exit()", '=HYPERLINK("https://example.com")', "=A1;alert(1)", "=Sheet1!A1", "1e3", "Infinity", "=WEBSERVICE(1)"]) {
    assert.equal(result(input).state, "error", input);
  }
  assert.equal(result("=UNRECOGNIZED").code, "NAME");
  assert.equal(result("=2>1").code, "TYPE");
});
test("calculations always use the supplied current review and never store source results in the draft", () => {
  const draft = createStudioSheetDraft(), first = review(), second = review();
  second.metadata.snapshotHash = "refreshed"; second.sales.summary!.netSalesCents = 20000;
  assert.equal(evaluateStudioSheet(draft, first).cells.A4.value, "105.0105");
  const refreshed = evaluateStudioSheet(draft, second);
  assert.equal(refreshed.snapshotHash, "refreshed"); assert.equal(refreshed.cells.A4.value, "210");
  assert.equal(JSON.stringify(draft).includes("snapshotHash"), false);
  assert.deepEqual(validateStudioSheetDraft(JSON.parse(JSON.stringify(draft))), draft);
});
test("persistable drafts reject source payloads, duplicate addresses and over-limit definitions", () => {
  assert.throws(() => validateStudioSheetDraft({ ...sheet(["1"]), rows: review().sales.rows }));
  assert.throws(() => validateStudioSheetDraft({ ...sheet(["1"]), cells: [{ ...sheet(["1"]).cells[0], result: "100" }] }));
  const duplicate = sheet(["1", "2"]); duplicate.cells[1].address = "A1"; assert.throws(() => validateStudioSheetDraft(duplicate));
  assert.throws(() => validateStudioSheetDraft(sheet(Array.from({ length: 33 }, () => "1"))));
  assert.throws(() => validateStudioSheetDraft(sheet(["1".repeat(257)])));
  assert.throws(() => validateStudioSheetDraft({ ...sheet(["1"]), version: "other" }));
});
test("presentation rounds only its display, using exact strings and clear units", () => {
  assert.equal(formatStudioDecimal("90071992547409.91", "money", "CAD"), "CAD 90,071,992,547,409.91");
  assert.equal(formatStudioDecimal("-1.005", "money", "CAD"), "CAD -1.01");
  assert.equal(formatStudioDecimal("0.05555", "percent", "CAD"), "5.56%");
  assert.equal(formatStudioDecimal("0.000000000001", "number", "CAD"), "0.000000000001");
});
test("the rendered assumption sheet labels native editors and never displays stale restricted financial values", () => {
  const current = review();
  const rendered = renderToStaticMarkup(createElement(StudioSheets, { review: current, initialSheet: "assumptions" }));
  assert.match(rendered, /<table class="studio-assumptions-table"/);
  assert.match(rendered, /<th scope="row"><code>A1<\/code><\/th>/);
  assert.match(rendered, /aria-label="A1 value or formula, Sales growth assumption"/);
  assert.match(rendered, /8 cells calculated from the current source scope/);
  assert.match(rendered, /CAD 40\.01/);
  current.margin = { state: "restricted", reason: "No cost permission" };
  const restricted = renderToStaticMarkup(createElement(StudioSheets, { review: current, initialSheet: "assumptions" }));
  assert.doesNotMatch(restricted, /CAD 40\.01|CAD 60\.00|CAD 61\.80/);
  assert.match(restricted, /Gross profit and cost references require margin permission/);
  assert.match(restricted, /aria-invalid="true"/);
});

test("source sheet renders only supplied chart lineage while retaining the loaded scope", () => {
  const current=review();current.sales.rows.push({...current.sales.rows[0],id:"other",locationRef:"unselected-location"});current.metadata.rowCount=2;
  const rendered=renderToStaticMarkup(createElement(StudioSheets,{review:current,sourceRows:[current.sales.rows[0]]}));
  assert.match(rendered, /Source rows retain the chart query/);
  assert.match(rendered, /1 matching rows/);
  assert.doesNotMatch(rendered, /unselected-location/);
});
