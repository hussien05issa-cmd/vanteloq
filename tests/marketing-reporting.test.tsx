import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { fetchMarketingReport } from "../server/integrations/marketing-reporting";
import { finiteMetric, metricRatio, metricChange, reportingWindow, marketingEvidenceSummary, type MarketingReport } from "../domain/marketing-reporting";
import { advisorEvidenceFingerprint, permittedAdvisorMemory } from "../domain/advisor-memory";
import { MarketingReportBody, formatMarketingValue } from "../app/marketing-reporting";
import type { SelectedMarketingResource } from "../server/integrations/marketing";

const now = new Date("2026-09-08T01:00:00Z");
const runtime = globalThis as typeof globalThis & { __vanteloqEnv?: Record<string, string> };
function source(dataset: SelectedMarketingResource["dataset"], ref: string): SelectedMarketingResource {
  return { id: "approved-selection", provider: dataset === "meta_ads" ? "meta" : "google", dataset, externalResourceRef: ref, scopeKind: "location", localLocationId: "allowed-location" };
}
async function withFetch(handler: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try { await run(); } finally { globalThis.fetch = original; runtime.__vanteloqEnv = {}; }
}

describe("marketing reports", { concurrency: false }, () => {
  test("missing, malformed and zero metrics remain distinct", () => {
    for (const value of [null, undefined, "", true, "NaN", "1e50", "12cats", {}, Infinity]) assert.equal(finiteMetric(value), null);
    assert.equal(finiteMetric("0"), 0);
    assert.equal(finiteMetric("12.25"), 12.25);
    assert.equal(metricRatio(0, 10, 100), 0);
    assert.equal(metricRatio(null, 10, 100), null);
    assert.equal(metricRatio(10, 0), null);
    assert.equal(metricChange(12, 0), null);
    assert.equal(metricChange(120, 100), 20);
  });
  test("report periods have identical day counts and never overlap", () => {
    for (const days of [7, 28, 90]) {
      const { period, previousPeriod } = reportingWindow(days, now, 3);
      assert.equal((Date.parse(period.end) - Date.parse(period.start)) / 86400000 + 1, days);
      assert.equal((Date.parse(previousPeriod.end) - Date.parse(previousPeriod.start)) / 86400000 + 1, days);
      assert.equal(Date.parse(period.start) - Date.parse(previousPeriod.end), 86400000);
      assert.equal(period.end, "2026-09-05");
    }
    assert.throws(() => reportingWindow(365));
  });
  test("GA4 requests approved properties only and obtains independent totals", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    await withFetch(async (input, init) => {
      const url = String(input), body = JSON.parse(String(init?.body));
      calls.push({ url, body });
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-report-token");
      assert.equal(init?.redirect, "manual"); assert.equal(init?.cache, "no-store");
      assert.ok(!url.includes("test-report-token"));
      const metrics = body.dimensions.length ? ["20", "5", "55", "1.5"] : ["100", "60", "200", "3.5"];
      return Response.json({ rows: [{ dimensionValues: [{ value: "Organic Search" }], metricValues: metrics.map((value) => ({ value })) }], rowCount: body.dimensions.length ? 300 : 1, metadata: { timeZone: "America/Edmonton", subjectToThresholding: true } });
    }, async () => {
      const report = await fetchMarketingReport("test-report-token", source("google_analytics", "properties/123"), "channels", 28, now);
      assert.equal(calls.length, 3);
      assert.ok(calls.every(({ url }) => url === "https://analyticsdata.googleapis.com/v1beta/properties/123:runReport"));
      assert.equal(report.totals.sessions, 100); assert.equal(report.rows[0].values.sessions, 20);
      assert.equal(report.totals.engagementRate, 60);
      assert.equal(report.rows[0].values.engagementRate, 25);
      assert.equal(report.totals.keyEvents, 3.5);
      assert.equal(report.period.end, "2026-09-06");
      assert.equal(report.truncated, true); assert.ok(report.warnings.some((v) => v.includes("threshold")));
    });
  });
  test("GA4 realtime has a rolling window and no misleading historical comparison", async () => {
    await withFetch(async (input) => {
      assert.match(String(input), /:runRealtimeReport$/);
      return Response.json({ rows: [{ metricValues: [{ value: "3" }, { value: "7" }] }] });
    }, async () => {
      const report = await fetchMarketingReport("test", source("google_analytics", "properties/123"), "realtime", 7, now);
      assert.equal(report.totals.activeUsers, 3); assert.equal(report.previousPeriod, null);
      assert.match(report.limitations.join(" "), /not a count of people currently/);
    });
  });
  test("Search Console ratios use separate property totals, not sums of top queries", async () => {
    await withFetch(async (input, init) => {
      assert.match(String(input), /sites\/sc-domain%3Aexample.ca\/searchAnalytics\/query$/);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.dataState, "final"); assert.equal(body.type, "web");
      return Response.json({ rows: body.dimensions.length ? [{ keys: ["retail analytics"], clicks: 2, impressions: 200, position: 11 }] : [{ clicks: 30, impressions: 1000, position: 8.75 }] });
    }, async () => {
      const report = await fetchMarketingReport("test", source("google_search_console", "sc-domain:example.ca"), "queries", 28, now);
      assert.equal(report.totals.ctr, 3); assert.equal(report.rows[0].values.ctr, 1);
      assert.equal(report.totals.position, 8.75); assert.equal(report.timeZone, "America/Los_Angeles");
      assert.equal(report.period.end, "2026-09-05");
    });
  });
  test("Business Profile monthly thresholds are not fabricated zeros and month rollover is correct", async () => {
    await withFetch(async (input) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("monthlyRange.startMonth.month"), "8");
      return Response.json({ searchKeywordsCounts: [{ searchKeyword: "retail shop", insightsValue: { threshold: "15" } }, { searchKeyword: "store", insightsValue: { value: "35" } }], nextPageToken: "do-not-follow" });
    }, async () => {
      const report = await fetchMarketingReport("test", source("google_business_profile", "accounts/123/locations/456"), "keywords", 28, new Date("2026-09-01T01:00:00Z"));
      assert.equal(report.period.start, "2026-08-01"); assert.equal(report.period.end, "2026-08-31");
      assert.equal(report.rows[0].values.impressions, null); assert.match(report.rows[0].note!, /threshold of 15/);
      assert.equal(report.rows[1].values.impressions, 35); assert.equal(report.truncated, true);
      assert.deepEqual(report.totals, {}); assert.equal(report.previousPeriod, null);
    });
  });
  test("Business Profile daily reporting preserves each source series without derived totals", async () => {
    await withFetch(async () => Response.json({ multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [{ dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [{ date: { year: 2026, month: 9, day: 5 }, value: "8" }] } }] }] }), async () => {
      const report = await fetchMarketingReport("test", source("google_business_profile", "accounts/123/locations/456"), "daily", 7, now);
      assert.equal(report.rows[0].values.CALL_CLICKS, 8); assert.equal(report.rows[0].values.WEBSITE_CLICKS, undefined);
      assert.deepEqual(report.totals, {});
    });
  });
  test("Meta reach uses an independent period query and spend carries the account currency", async () => {
    runtime.__vanteloqEnv = { META_GRAPH_API_VERSION: "v25.0" };
    await withFetch(async (input, init) => {
      const url = new URL(String(input)); assert.ok(!url.searchParams.has("access_token"));
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test");
      if (url.searchParams.has("fields") && !url.pathname.endsWith("insights")) return Response.json({ currency: "USD", timezone_name: "America/New_York" });
      return Response.json({ data: url.searchParams.get("time_increment") === "1" ? [
        { date_start: "2026-09-04", impressions: "300", reach: "200", inline_link_clicks: "10", spend: "20" },
        { date_start: "2026-09-05", impressions: "600", reach: "300", inline_link_clicks: "20", spend: "40" },
      ] : [{ impressions: "900", reach: "350", inline_link_clicks: "30", spend: "60" }] });
    }, async () => {
      const report = await fetchMarketingReport("test", source("meta_ads", "act_456"), "daily", 7, now);
      assert.equal(report.currency, "USD"); assert.equal(report.totals.reach, 350);
      assert.notEqual(report.totals.reach, report.rows.reduce((n, row) => n + row.values.reach!, 0));
      assert.equal(report.totals.linkCpc, 2);
      assert.equal(report.totals.linkCtr, 30 / 900 * 100);
      assert.match(report.limitations.join(" "), /not Facebook Page or Instagram organic/);
    });
  });
  test("Google Ads reports protect credentials and convert micros once", async () => {
    runtime.__vanteloqEnv = { GOOGLE_ADS_DEVELOPER_TOKEN: "test-developer", GOOGLE_ADS_API_VERSION: "v25" };
    await withFetch(async (input, init) => {
      if (String(input).endsWith("customers:listAccessibleCustomers")) return Response.json({ resourceNames: ["customers/123"] });
      if (JSON.parse(String(init?.body)).query.includes("FROM customer LIMIT")) return Response.json({ results: [{ customer: { resourceName: "customers/123" } }] });
      assert.match(String(input), /customers\/123\/googleAds:search$/);
      assert.equal(new Headers(init?.headers).get("developer-token"), null);
      assert.match(JSON.parse(String(init?.body)).query, /BETWEEN '2026-/);
      return Response.json({ results: [{ customer: { currencyCode: "CAD", timeZone: "America/Edmonton" }, campaign: { name: "Store visits" }, metrics: { costMicros: "123450000", clicks: "100", impressions: "10000", conversions: 3.25 } }] });
    }, async () => {
      const report = await fetchMarketingReport("test", source("google_ads", "customers/123"), "campaigns", 7, now);
      assert.equal(report.currency, "CAD"); assert.equal(report.totals.spend, 123.45);
      assert.equal(report.totals.conversions, 3.25);
    });
  });
  test("invalid selections and incompatible report views fail before any provider request", async () => {
    await withFetch(async () => { throw new Error("No provider request should happen"); }, async () => {
      await assert.rejects(fetchMarketingReport("test", source("google_analytics", "https://malicious.invalid"), "daily", 28), /valid Analytics property/);
      await assert.rejects(fetchMarketingReport("test", source("meta_ads", "act_456"), "queries", 28), /supported by this source/);
      await assert.rejects(fetchMarketingReport("test", source("google_ads", "customers/123"), "daily", 28), /not been enabled/);
      await assert.rejects(fetchMarketingReport("test", source("google_analytics", "properties/123"), "daily", 365), /90 day report/);
    });
  });
  test("provider errors never leak raw error bodies or tokens", async () => {
    await withFetch(async () => new Response("private-token-and-error-details", { status: 403 }), async () => {
      await assert.rejects(fetchMarketingReport("test", source("google_analytics", "properties/123"), "daily", 7), (error: Error) => !error.message.includes("private-token") && error.message.includes("API permissions"));
    });
  });
  test("empty provider results remain unavailable", async () => {
    await withFetch(async () => Response.json({ rows: [] }), async () => {
      const report = await fetchMarketingReport("test", source("google_analytics", "properties/123"), "daily", 7);
      assert.equal(report.totals.sessions, null); assert.equal(report.totals.engagementRate, null);
    });
  });
});

test("AI marketing evidence excludes GBP, private labels, unknown currency and incomplete comparisons", () => {
  const row = { selectionId: "private-resource-id", dataset: "google_search_console", metricDate: "2026-09-04", metricKey: "search_clicks", valueMilli: 5000 };
  const evidence = marketingEvidenceSummary([
    row, { ...row, metricKey: "search_impressions", valueMilli: 100000 }, { ...row, metricKey: "search_position", valueMilli: 5000 },
    { ...row, metricDate: "2026-09-05", metricKey: "search_impressions", valueMilli: 900000 }, { ...row, metricDate: "2026-09-05", metricKey: "search_position", valueMilli: 10000 },
    { ...row, metricKey: "query", valueMilli: 1 }, { ...row, dataset: "meta_ads", metricKey: "meta_spend", valueMilli: 999 },
    { ...row, dataset: "google_business_profile", metricKey: "gbp_call_clicks", valueMilli: 999 },
  ], now);
  assert.equal(evidence.sources.length, 1);
  assert.equal(evidence.sources[0].current.values.average_position, 9.5);
  assert.equal(evidence.sources[0].current.values.search_ctr_percent, null);
  assert.equal(evidence.sources[0].comparisonComplete, false);
  assert.doesNotMatch(JSON.stringify(evidence), /private-resource-id|gbp_call_clicks|meta_spend/);
});
test("Advisor history is invalidated by changed permissions, locations or evidence", async () => {
  const evidence = { marketing: { sessions: 10 } };
  const key = await advisorEvidenceFingerprint(evidence, ["marketing.view", "insights.view"], ["east"]);
  assert.equal(await advisorEvidenceFingerprint(evidence, ["insights.view", "marketing.view"], ["east"]), key);
  for (const changed of [
    await advisorEvidenceFingerprint(evidence, ["insights.view"], ["east"]),
    await advisorEvidenceFingerprint(evidence, ["marketing.view", "insights.view"], ["west"]),
    await advisorEvidenceFingerprint({ marketing: null }, ["marketing.view", "insights.view"], ["east"]),
  ]) assert.notEqual(changed, key);
  assert.deepEqual(permittedAdvisorMemory([
    { role: "assistant", content: "Old sensitive answer", evidence_json: "[]" },
    { role: "assistant", content: "Invalid JSON", evidence_json: "{" },
    { role: "assistant", content: "Allowed", evidence_json: JSON.stringify({ accessFingerprint: key }) },
  ], key), [{ role: "assistant", content: "Allowed" }]);
});
test("report presentation is escaped, keyboard-readable and preserves missing values and fractional conversions", () => {
  const report: MarketingReport = { dataset: "google_search_console", view: "daily", ...reportingWindow(7, now, 3), columns: [{ key: "clicks", label: "Clicks", unit: "count" }], rows: [{ label: "2026-09-01", values: { clicks: 5 } }, { label: "2026-09-03", values: { clicks: 7 } }, { label: "<script>unsafe()</script>", values: { clicks: null } }], totals: { clicks: 12 }, previous: { clicks: null }, currency: null, timeZone: "America/Los_Angeles", fetchedAt: now.toISOString(), warnings: [], limitations: ["Finalized source data"], truncated: false };
  const html = renderToStaticMarkup(<MarketingReportBody report={report}/>);
  assert.match(html, /scope="col"/); assert.match(html, /<caption/); assert.match(html, /tabindex="0"/);
  assert.match(html, /Not available/); assert.match(html, /Comparison unavailable/);
  assert.doesNotMatch(html, /<script>|NaN|Infinity/); assert.match(html, /&lt;script&gt;/);
  const path = /<path d="([^"]*)"/.exec(html)?.[1] ?? "";
  assert.equal((path.match(/M/g) ?? []).length, 2); assert.ok(!path.includes("L"));
  assert.equal(formatMarketingValue(3.25, { key: "conversions", label: "Conversions", unit: "count" }, null), "3.25");
});
