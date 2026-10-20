import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import StudioSql from "../app/studio-sql.tsx";
import type { StudioExecutiveReview, StudioSalesRow } from "../domain/data-studio.ts";
import { parseStudioQuery, runStudioQuery, studioQuerySchema, studioQuerySourceRows } from "../domain/studio-query.ts";

const row = (id: string, businessDate: string, locationRef: string, netSalesCents: number, costOfGoodsCents: number | null = null): StudioSalesRow => ({
  id, businessDate, locationRef, netSalesCents, costOfGoodsCents, sourceKind: "owner_summary", transactionCount: 1, unitsSold: 0.125,
});
const review = (rows: StudioSalesRow[], restricted = false): StudioExecutiveReview => ({
  version: "studio-v1", metadata: { organizationId: "org", currency: "CAD", timeZone: "America/Denver", from: "2026-10-01", to: "2026-10-03", locationIds: ["A", "B"], generatedUtc: "2026-10-04T00:00:00Z", extractionUtc: "2026-10-04T00:00:00Z", specificationHash: "spec", snapshotHash: "snapshot", consistency: "component_read_transactions", calculationVersion: "v1", dataMode: "stored_records", rowCount: rows.length, limit: 2000, truncated: false, canExport: true, sourceAuthority: "Stored records", providerHistoryCertified: false, recordedDayCount: 3, calendarDayCount: 3, latestRecordUpdateUtc: null },
  sales: { state: "recorded", reason: null, rows, summary: null }, margin: { state: restricted ? "restricted" : "recorded", reason: null }, inventory: { state: "unavailable", reason: "No data" }, cash: { state: "unavailable", reason: "No data" }, limitations: [],
});
const source = () => review([row("1", "2026-10-01", "A", 100, 25), row("2", "2026-10-01", "B", 300, null), row("3", "2026-10-02", "A", 200, 50)]);

test("Studio SQL filters authorized rows, groups exact cents and orders alias totals", () => {
  const result = runStudioQuery(source(), "SELECT business_date, SUM(net_sales_cents) AS total FROM sales WHERE net_sales_cents >= 100 AND business_date <= '2026-10-02' GROUP BY business_date ORDER BY total DESC LIMIT 1") as { columns: string[]; rows: unknown[]; matchedRows: number; totalResultRows: number; truncated: boolean };
  assert.deepEqual(result.columns, ["business_date", "total"]);
  assert.deepEqual(result.rows, [{ business_date: "2026-10-01", total: 400 }]);
  assert.equal(result.matchedRows, 3); assert.equal(result.totalResultRows, 2); assert.equal(result.truncated, true);
});

test("Studio SQL refuses writes, extra statements and every unsupported trailing construct", () => {
  for (const sql of [
    "DELETE FROM sales", "SELECT net_sales_cents FROM sales; SELECT net_sales_cents FROM sales", "SELECT net_sales_cents FROM sales;;",
    "SELECT net_sales_cents FROM sales -- ignored", "SELECT net_sales_cents FROM sales /* ignored */", "SELECT net_sales_cents FROM sales JOIN other",
    "SELECT net_sales_cents FROM sales UNION SELECT 1", "SELECT (SELECT net_sales_cents FROM sales) FROM sales", "SELECT AVG(net_sales_cents) FROM sales",
    "SELECT net_sales_cents FROM sales WHERE location_ref = 'A' OR location_ref = 'B'", "SELECT DISTINCT location_ref FROM sales", "SELECT SUM(net_sales_cents) FROM sales HAVING 1=1",
    "SELECT net_sales_cents + 1 FROM sales", "SELECT net_sales_cents FROM sales LIMIT 1 OFFSET 1", "SELECT net_sales_cents FROM secrets", "SELECT organization_id FROM sales",
    "SELECT net_sales_cents FROM sales ORDER BY random()", "SELECT net_sales_cents FROM sales WHERE net_sales_cents = 100 garbage", "SELECT net_sales_cents FROM sales LIMIT -1",
  ]) assert.throws(() => runStudioQuery(source(), sql), sql);
});

test("Studio SQL treats escaped quotes and statement text inside strings as literal data", () => {
  const input = review([row("1", "2026-10-01", "Owner's; SELECT", 100)]);
  const result = runStudioQuery(input, "select record_id from SALES where location_ref = 'Owner''s; SELECT';") as { rows: unknown[] };
  assert.deepEqual(result.rows, [{ record_id: "1" }]);
});

test("Studio SQL blocks restricted cost and profit references in every supported clause", () => {
  const input = review([row("1", "2026-10-01", "A", 100, 25)], true);
  for (const sql of ["SELECT cost_of_goods_cents FROM sales", "SELECT gross_profit_cents FROM sales", "SELECT COUNT(cost_of_goods_cents) FROM sales", "SELECT record_id FROM sales WHERE cost_of_goods_cents > 0", "SELECT record_id FROM sales ORDER BY gross_profit_cents"])
    assert.throws(() => runStudioQuery(input, sql), /permitted|permission|available/i);
  const result = runStudioQuery(input, "SELECT * FROM sales") as { columns: string[]; rows: Record<string, unknown>[] };
  assert.equal(result.columns.includes("cost_of_goods_cents"), false); assert.equal(result.columns.includes("gross_profit_cents"), false);
  assert.equal("cost_of_goods_cents" in result.rows[0], false);
});

test("Studio SQL preserves missing financial evidence and counts only known values", () => {
  const result = runStudioQuery(source(), "SELECT SUM(cost_of_goods_cents) AS costs, SUM(gross_profit_cents) AS profit, COUNT(cost_of_goods_cents) AS known, COUNT(*) AS records FROM sales") as { rows: unknown[]; warnings: string[] };
  assert.deepEqual(result.rows, [{ costs: 75, profit: 225, known: 2, records: 3 }]); assert.ok(result.warnings.length);
  const empty = runStudioQuery(source(), "SELECT SUM(net_sales_cents) AS sales, COUNT(*) AS records, MIN(business_date) AS first FROM sales WHERE location_ref = 'none'") as { rows: unknown[]; matchedRows: number };
  assert.deepEqual(empty.rows, [{ sales: null, records: 0, first: null }]); assert.equal(empty.matchedRows, 0);
  const unknown = runStudioQuery(review([row("1", "2026-10-01", "A", 0)]), "SELECT SUM(gross_profit_cents) AS profit, MIN(cost_of_goods_cents) AS low, MAX(cost_of_goods_cents) AS high FROM sales") as { rows: unknown[] };
  assert.deepEqual(unknown.rows, [{ profit: null, low: null, high: null }]);
});

test("Studio SQL supports explicit null filters without coercing null comparisons to true", () => {
  const result = runStudioQuery(source(), "SELECT record_id FROM sales WHERE cost_of_goods_cents IS NULL") as { rows: unknown[] };
  assert.deepEqual(result.rows, [{ record_id: "2" }]);
  const compared = runStudioQuery(source(), "SELECT record_id FROM sales WHERE cost_of_goods_cents != NULL") as { rows: unknown[] };
  assert.deepEqual(compared.rows, []);
});

test("Studio SQL uses exact integer cents and thousandths and refuses unsafe numeric data", () => {
  const result = runStudioQuery(review([{ ...row("1", "2026-10-01", "A", 100), unitsSold: 0.1 + 0.2 }, { ...row("2", "2026-10-01", "A", -50), unitsSold: -0.025 }]), "SELECT SUM(units_sold) AS units, SUM(net_sales_cents) AS sales FROM sales") as { rows: unknown[] };
  assert.deepEqual(result.rows, [{ units: 0.275, sales: 50 }]);
  for (const input of [review([row("1", "2026-10-01", "A", Number.MAX_SAFE_INTEGER + 1)]), review([row("1", "2026-10-01", "A", Number.MAX_SAFE_INTEGER), row("2", "2026-10-01", "A", 1)])]) assert.throws(() => runStudioQuery(input, "SELECT SUM(net_sales_cents) FROM sales"), /exact|overflow|supported/i);
  assert.throws(() => runStudioQuery(review([row("1", "2026-10-01", "A", Number.MAX_SAFE_INTEGER, -1)]), "SELECT gross_profit_cents FROM sales"), /exact|overflow|supported/i);
  assert.throws(() => runStudioQuery(review([{ ...row("1", "2026-10-01", "A", 100), unitsSold: 0.0001 }]), "SELECT units_sold FROM sales"));
  assert.throws(() => runStudioQuery(source(), "SELECT record_id FROM sales WHERE net_sales_cents = 100.5"));
  assert.throws(() => runStudioQuery(source(), "SELECT record_id FROM sales WHERE net_sales_cents = '100'"));
});

test("Studio SQL rejects ambiguous grouping, alias collisions and references outside selected results", () => {
  for (const sql of ["SELECT location_ref, SUM(net_sales_cents) FROM sales", "SELECT business_date, SUM(net_sales_cents) FROM sales GROUP BY location_ref", "SELECT net_sales_cents FROM sales GROUP BY net_sales_cents", "SELECT net_sales_cents AS total, SUM(transaction_count) AS total FROM sales", "SELECT net_sales_cents AS constructor FROM sales", "SELECT record_id FROM sales ORDER BY net_sales_cents"])
    assert.throws(() => runStudioQuery(source(), sql), sql);
});

test("Studio SQL plans round trip case insensitive names, escaping and default aggregate keys", () => {
  const sql = "select location_ref, SUM(net_sales_cents), COUNT(*) FROM sales where location_ref <> 'Owner''s' GROUP BY location_ref ORDER BY sum_net_sales_cents desc;";
  const plan = parseStudioQuery(source(), sql);
  assert.deepEqual(parseStudioQuery(source(), plan.normalizedSql), plan);
  const result = runStudioQuery(source(), sql);
  assert.deepEqual(result.columns, ["location_ref", "sum_net_sales_cents", "count_rows"]);
  assert.deepEqual(result.rows, [{ location_ref: "A", sum_net_sales_cents: 300, count_rows: 2 }, { location_ref: "B", sum_net_sales_cents: 300, count_rows: 1 }]);
  assert.equal(result.columnDetails[1].type, "cents"); assert.equal(result.columnDetails[2].type, "count");
  assert.equal(studioQuerySchema(source()).find(spec => spec.field === "gross_profit_cents")?.nullable, true);
});

test("Studio SQL refuses queries exceeding work and serialized output budgets", () => {
  const input = review(Array.from({ length: 2000 }, (_, index) => row(String(index).padStart(180, "x"), "2026-10-01", "A", index)));
  const projections = Array.from({ length: 16 }, (_, index) => `net_sales_cents AS n${index}`).join(", ");
  const predicates = Array.from({ length: 16 }, () => "net_sales_cents >= 0").join(" AND ");
  assert.throws(() => runStudioQuery(input, `SELECT ${projections} FROM sales WHERE ${predicates} ORDER BY n0, n1, n2 LIMIT 2000`), /work budget/);
  const strings = Array.from({ length: 16 }, (_, index) => `record_id AS n${index}`).join(", ");
  assert.throws(() => runStudioQuery(input, `SELECT ${strings} FROM sales LIMIT 2000`), /2 MiB/);
});

test("Studio SQL validates snapshot completeness and enforces query and result bounds", () => {
  const many = review(Array.from({ length: 501 }, (_, index) => row(String(index), "2026-10-01", "A", index)));
  const result = runStudioQuery(many, "SELECT record_id FROM sales") as { rows: unknown[]; totalResultRows: number; truncated: boolean };
  assert.equal(result.rows.length, 500); assert.equal(result.totalResultRows, 501); assert.equal(result.truncated, true);
  const none = runStudioQuery(source(), "SELECT record_id FROM sales LIMIT 0") as { rows: unknown[]; truncated: boolean };
  assert.deepEqual(none.rows, []); assert.equal(none.truncated, true);
  assert.throws(() => runStudioQuery(source(), "SELECT record_id FROM sales LIMIT 2001"));
  assert.throws(() => runStudioQuery(source(), "SELECT record_id FROM sales" + " ".repeat(8192)));
  assert.throws(() => runStudioQuery({ ...source(), metadata: { ...source().metadata, rowCount: 0 } }, "SELECT record_id FROM sales"));
  assert.throws(() => runStudioQuery({ ...source(), sales: { ...source().sales, state: "unavailable" } }, "SELECT COUNT(*) FROM sales"), /unavailable|available|recorded/i);
});

test("Studio SQL editor renders an accessible draft, permitted schema and explicit snapshot limits", () => {
  const html = renderToStaticMarkup(createElement(StudioSql, { review: source(), initialSql: "SELECT COUNT(*) FROM sales", onPin: () => {} }));
  assert.match(html, /SQL query/); assert.match(html, /<textarea/); assert.match(html, /SELECT COUNT\(\*\) FROM sales/);
  assert.match(html, /Run query/); assert.match(html, /Supported SQL/); assert.match(html, /Permitted sales schema/); assert.match(html, /integer cents/);
  assert.match(html, /Pin to Dashboard/); assert.match(html, /2,000/);
  const restricted = renderToStaticMarkup(createElement(StudioSql, { review: review([row("secret-row", "2026-10-01", "A", 123456789, 987654321)], true) }));
  assert.doesNotMatch(restricted, /cost_of_goods_cents|gross_profit_cents|123456789|987654321/);
});

test("Studio SQL reparses saved query definitions against changed permissions and date bounds", () => {
  const saved = parseStudioQuery(source(), "SELECT business_date, SUM(gross_profit_cents) AS profit FROM sales GROUP BY business_date ORDER BY business_date LIMIT 2000").normalizedSql;
  assert.throws(() => runStudioQuery(review(source().sales.rows, true), saved), /not available.*permitted/);
  const day = runStudioQuery(source(), "SELECT record_id FROM sales WHERE business_date >= '2026-10-02' AND business_date <= '2026-10-02'");
  assert.deepEqual(day.rows, [{ record_id: "3" }]);
  assert.throws(() => runStudioQuery(source(), "SELECT record_id FROM sales WHERE business_date = '2026-02-29'"), /valid.*dates/);
  const costs = runStudioQuery(source(), "SELECT business_date, location_ref, MIN(net_sales_cents) AS low, MAX(net_sales_cents) AS high FROM sales WHERE cost_of_goods_cents IS NOT NULL GROUP BY business_date, location_ref ORDER BY business_date DESC");
  assert.deepEqual(costs.rows, [{ business_date: "2026-10-02", location_ref: "A", low: 200, high: 200 }, { business_date: "2026-10-01", location_ref: "A", low: 100, high: 100 }]);
});

test("Studio SQL source drillthrough retains location and amount predicates before grouping by date", () => {
  const input = review([row("a", "2026-10-01", "A", 100, 25), row("b", "2026-10-01", "B", 500, 100), row("small", "2026-10-01", "A", 10, 0), row("second", "2026-10-02", "A", 200, 50)]);
  const sql = "SELECT business_date, SUM(net_sales_cents) AS total FROM sales WHERE location_ref = 'A' AND net_sales_cents >= 100 GROUP BY business_date ORDER BY total DESC LIMIT 1";
  assert.deepEqual(studioQuerySourceRows(input, sql).map(value => value.id), ["a", "second"]);
  assert.equal(runStudioQuery(input, sql).totalResultRows, 2);
  assert.deepEqual(studioQuerySourceRows(input, "SELECT COUNT(*) FROM sales WHERE location_ref = 'none'"), []);
});

test("Studio SQL source drillthrough reparses original financial projections and filters on permission changes", () => {
  const input = source();
  const restricted = review(input.sales.rows, true);
  const projection = "SELECT business_date, SUM(gross_profit_cents) AS profit FROM sales GROUP BY business_date";
  const predicate = "SELECT business_date, SUM(net_sales_cents) AS total FROM sales WHERE cost_of_goods_cents > 0 GROUP BY business_date";
  assert.deepEqual(studioQuerySourceRows(input, predicate).map(value => value.id), ["1", "3"]);
  assert.throws(() => studioQuerySourceRows(restricted, projection), /not available.*permitted/);
  assert.throws(() => studioQuerySourceRows(restricted, predicate), /not available.*permitted/);
  assert.throws(() => studioQuerySourceRows(input, predicate + "; DELETE FROM sales"));
  assert.throws(() => studioQuerySourceRows({ ...input, metadata: { ...input.metadata, rowCount: 0 } }, predicate));
  assert.throws(() => studioQuerySourceRows(review([row("duplicate", "2026-10-01", "A", 100), row("duplicate", "2026-10-01", "B", 500)]), "SELECT SUM(net_sales_cents) FROM sales WHERE location_ref = 'A'"), /unique|ambiguous/);
});
