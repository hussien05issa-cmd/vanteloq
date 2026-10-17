import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { fetchMarketingReport } from "../server/integrations/marketing-reporting";
import { MarketingSourceReportSummary } from "../app/marketing-source-overview";
import { MarketingReportBody } from "../app/marketing-reporting";
import type { SelectedMarketingResource } from "../server/integrations/marketing";

const now = new Date("2026-09-08T01:00:00Z");
const selection: SelectedMarketingResource = { id: "approved-ga4", provider: "google", dataset: "google_analytics", externalResourceRef: "properties/123", scopeKind: "location", localLocationId: "allowed-location" };
type Row = { dimensionValues: { value: string }[]; metricValues: { value: string }[] };
const eventRow = (count: string, date?: string, name = "generate_lead"): Row => ({ dimensionValues: (date ? [date, name] : [name]).map(value => ({ value })), metricValues: [{ value: count }] });
const traffic = (daily: boolean) => Response.json({ rows: [{ dimensionValues: daily ? [{ value: "20260906" }] : [], metricValues: ["100", "60", "200", "12.5"].map(value => ({ value })) }], rowCount: 1, metadata: { timeZone: "America/Edmonton" } });
async function withFetch(handler: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch; globalThis.fetch = handler;
  try { await run(); } finally { globalThis.fetch = original; }
}

describe("GA4 lead events", { concurrency: false }, () => {
  test("daily leads use exact event queries and independent current/prior totals without filtering traffic", async () => {
    const requests: Array<{ dateRanges: { startDate: string; endDate: string }[]; dimensions: { name: string }[]; metrics: { name: string }[]; dimensionFilter?: unknown }> = [];
    await withFetch(async (input, init) => {
      assert.equal(String(input), "https://analyticsdata.googleapis.com/v1beta/properties/123:runReport");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-read-token");
      assert.equal(init?.cache, "no-store");
      const body = JSON.parse(String(init?.body)); requests.push(body);
      if (!body.dimensionFilter) {
        assert.deepEqual(body.metrics.map((metric: { name: string }) => metric.name), ["sessions", "engagedSessions", "screenPageViews", "keyEvents"]);
        return traffic(body.dimensions.length > 0);
      }
      assert.deepEqual(body.dimensionFilter, { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: "generate_lead", caseSensitive: true } } });
      assert.deepEqual(body.metrics, [{ name: "eventCount" }]);
      assert.equal(body.keepEmptyRows, true);
      assert.equal(body.limit, "250");
      if (body.dimensions.length === 2) {
        assert.deepEqual(body.dimensions, [{ name: "date" }, { name: "eventName" }]);
        return Response.json({ rows: [eventRow("5", "20260904"), eventRow("0", "20260905"), eventRow("999", "20260903", "generate_lead_copy"), eventRow("777", "20260902", "Generate_lead"), eventRow("999", "20260930")], metadata: { subjectToThresholding: true } });
      }
      assert.deepEqual(body.dimensions, [{ name: "eventName" }]);
      const current = body.dateRanges[0].endDate === "2026-09-06";
      return Response.json({ rows: [eventRow(current ? "11" : "3")], metadata: current ? {} : { samplingMetadatas: [{}] } });
    }, async () => {
      const report = await fetchMarketingReport("fixture-read-token", selection, "daily", 7, now);
      assert.equal(requests.length, 6);
      const leadRequests = requests.filter(request => request.dimensionFilter);
      assert.deepEqual(leadRequests.map(request => request.dateRanges[0]), [{ startDate: "2026-08-31", endDate: "2026-09-06" }, { startDate: "2026-08-31", endDate: "2026-09-06" }, { startDate: "2026-08-24", endDate: "2026-08-30" }]);
      assert.equal(report.totals.sessions, 100); assert.equal(report.totals.keyEvents, 12.5);
      assert.equal(report.totals.leadEvents, 11); assert.equal(report.previous?.leadEvents, 3);
      assert.deepEqual(report.rows.map(row => [row.label, row.values.leadEvents]), [["2026-09-04", 5], ["2026-09-05", 0], ["2026-09-06", null]]);
      assert.equal(report.rows[0].values.sessions, null, "a lead-only date does not invent a session count");
      assert.equal(report.rows[2].values.sessions, 100);
      assert.equal(report.columns.filter(column => column.key === "leadEvents").length, 1);
      assert.match(report.warnings.join(" "), /thresholding/); assert.match(report.warnings.join(" "), /sampled/);
      const html = renderToStaticMarkup(<MarketingSourceReportSummary report={report}/>);
      assert.match(html, /Lead events · generate_lead<\/dt><dd>11/);
      assert.match(html, /event counts, not unique people/);
      assert.match(html, /Website or app event tagging is required/);
      assert.doesNotMatch(html, /Lead events are not separately identified/);
      assert.match(report.limitations.join(" "), /not added to key events/);
    });
  });

  test("missing, duplicate, malformed or differently named lead events stay unavailable, while explicit zero survives", async () => {
    for (const [rows, expected] of [
      [[], null], [[eventRow("9", undefined, "generate_lead_custom")], null],
      [[eventRow("9", undefined, "Generate_lead")], null], [[eventRow("-1")], null],
      [[eventRow("3.5")], null], [[eventRow("not-a-count")], null],
      [[eventRow("4"), eventRow("4")], null], [[eventRow("0")], 0],
    ] as Array<[Row[], number | null]>) {
      await withFetch(async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        return body.dimensionFilter ? Response.json({ rows }) : traffic(body.dimensions.length > 0);
      }, async () => {
        const report = await fetchMarketingReport("fixture-read-token", selection, "daily", 7, now);
        assert.equal(report.totals.leadEvents, expected); assert.equal(report.previous?.leadEvents, expected);
        assert.equal(report.totals.sessions, 100);
        assert.equal(report.rows[0].values.leadEvents, null, "period totals cannot be reused as daily rows");
        if (expected === null) assert.match(report.warnings.join(" "), /does not establish zero leads/);
        else assert.doesNotMatch(report.warnings.join(" "), /does not establish zero leads/);
      });
    }
  });

  test("supplemental lead failures preserve traffic and suppress unavailable comparisons without exposing provider details", async () => {
    for (const failure of ["all", "prior"]) await withFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      if (!body.dimensionFilter) return traffic(body.dimensions.length > 0);
      if (failure === "all" || body.dateRanges[0].endDate === "2026-08-30") return new Response("private-provider-token-and-error", { status: 429 });
      return Response.json({ rows: body.dimensions.length === 2 ? [eventRow("7", "20260906")] : [eventRow("7")] });
    }, async () => {
      const report = await fetchMarketingReport("fixture-read-token", selection, "daily", 7, now);
      assert.equal(report.totals.sessions, 100);
      assert.equal(report.totals.leadEvents, failure === "all" ? null : 7);
      assert.equal(report.previous?.leadEvents, null);
      assert.match(report.warnings.join(" "), /lead-event measures could not be retrieved/);
      const html = renderToStaticMarkup(<MarketingReportBody report={report}/>);
      assert.match(html, /Comparison unavailable/);
      assert.doesNotMatch(html, /private-provider-token-and-error/);
    });
  });

  test("lead daily duplicates are not added and invalid or out-of-period dates are excluded", async () => {
    await withFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      if (!body.dimensionFilter) return traffic(body.dimensions.length > 0);
      return Response.json({ rows: body.dimensions.length === 2 ? [eventRow("2", "20260905"), eventRow("2", "20260905"), eventRow("3", "20260230"), eventRow("4", "20260930"), eventRow("5", "20260830"), eventRow("9", "20260906")] : [eventRow("13")] });
    }, async () => {
      const report = await fetchMarketingReport("fixture-read-token", selection, "daily", 7, now);
      assert.deepEqual(report.rows.map(row => [row.label, row.values.leadEvents]), [["2026-09-05", null], ["2026-09-06", 9]]);
      assert.equal(report.totals.leadEvents, 13, "independent provider totals are not reconstructed from daily rows");
    });
  });
});
