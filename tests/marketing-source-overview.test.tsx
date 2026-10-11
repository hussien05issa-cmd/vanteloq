import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import MarketingSourceOverview, { MarketingSourceReportSummary } from "../app/marketing-source-overview";
import { MarketingReportBody } from "../app/marketing-reporting";
import { createMarketingReportReader, readMarketingReport, readMarketingSources, visibleMarketingReport, type MarketingReportRequest, type MarketingReportSnapshot } from "../app/marketing-report-reader";
import { marketingSourceSummary } from "../domain/marketing-source-summary";
import type { MarketingReport } from "../domain/marketing-reporting";

const request: MarketingReportRequest = { locationId: "north store", selectionId: "meta-account-one", dataset: "meta_ads", view: "daily", days: 28 };
const report = (overrides: Partial<MarketingReport> = {}): MarketingReport => ({
  dataset: "meta_ads", view: "daily", period: { start: "2026-09-01", end: "2026-09-28" }, previousPeriod: null,
  columns: [{ key: "reach", label: "Reach", unit: "count" }, { key: "spend", label: "Spend", unit: "currency" }, { key: "linkClicks", label: "Link clicks", unit: "count" }],
  rows: [{ label: "2026-09-27", values: { reach: 70, spend: 12, linkClicks: 1 } }, { label: "2026-09-28", values: { reach: 70, spend: 13, linkClicks: 2 } }],
  totals: { reach: 90, spend: 25, linkClicks: 3 }, previous: null, currency: "USD", timeZone: "America/New_York", fetchedAt: "2026-09-30T01:02:00Z", warnings: [], limitations: [], truncated: false, ...overrides,
});

function harness() {
  const states: (MarketingReportSnapshot | null)[] = [];
  const reads: { context: MarketingReportRequest; signal: AbortSignal; resolve: (value: MarketingReport) => void; reject: (reason: Error) => void }[] = [];
  const reader = createMarketingReportReader({ read: (context, signal) => new Promise((resolve, reject) => reads.push({ context, signal, resolve, reject })), onChange: state => states.push(state) });
  return { reader, reads, states, latest: () => states.at(-1) ?? null };
}

test("the bridge requests only the selected source, location and period with no write or cache", async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await readMarketingReport(async (input, init) => {
    calls++;
    const url = new URL(String(input), "https://fixture.invalid");
    assert.equal(url.pathname, "/api/v1/marketing/reports");
    assert.equal(url.searchParams.get("location"), "north store");
    assert.equal(url.searchParams.get("selectionId"), "meta-account-one");
    assert.equal(url.searchParams.get("days"), "28");
    assert.equal(url.searchParams.get("view"), "daily");
    assert.equal(init?.method ?? "GET", "GET");
    assert.equal(init?.body, undefined);
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.signal, controller.signal);
    return Response.json({ source: { id: request.selectionId }, report: report() });
  }, request, controller.signal);
  assert.equal(calls, 1);
  assert.equal(result.currency, "USD");
  assert.equal(result.totals.reach, 90);
});

test("mismatched source, dataset or report view fails closed instead of showing another account", async () => {
  for (const response of [
    { source: { id: "other-account" }, report: report() },
    { source: { id: request.selectionId }, report: report({ dataset: "google_ads" }) },
    { source: { id: request.selectionId }, report: report({ view: "campaigns" }) },
  ]) await assert.rejects(readMarketingReport(async () => Response.json(response), request, new AbortController().signal), /does not match this source/);
  await assert.rejects(readMarketingReport(async () => Response.json({ error: { message: "This source is no longer authorized." } }, { status: 403 }), request, new AbortController().signal), /no longer authorized/);
});

test("opening the reader is passive, duplicate loads serialize, and explicit retry can recover", async () => {
  const f = harness();
  assert.equal(f.reads.length, 0, "mounting alone must not request provider measurements");
  const first = f.reader.load(request);
  await f.reader.load(request); await f.reader.load({ ...request });
  assert.equal(f.reads.length, 1);
  f.reads[0].reject(new Error("Provider request limited")); await first;
  assert.equal(f.latest()?.status, "error"); assert.equal(f.latest()?.report, null);
  const retry = f.reader.load(request);
  assert.equal(f.reads.length, 2); assert.equal(f.latest()?.error, "");
  f.reads[1].resolve(report()); await retry;
  assert.equal(f.latest()?.status, "ready"); assert.equal(f.latest()?.report?.totals.reach, 90);
  f.reader.dispose();
});

test("account, location, period and view changes hide old values immediately and reject late reads", async () => {
  for (const change of [{ selectionId: "meta-account-two" }, { locationId: "south" }, { locationId: null }, { days: 7 }, { view: "campaigns" as const }]) {
    const f = harness();
    const initial = f.reader.load(request); f.reads[0].resolve(report()); await initial;
    const next = { ...request, ...change };
    assert.equal(visibleMarketingReport(f.latest(), next), null, "render fence must work before effects run");
    const stale = f.reader.load(request);
    const current = f.reader.load(next);
    assert.equal(f.reads[1].signal.aborted, true);
    f.reads[2].resolve(report({ view: next.view, totals: { reach: 17 } })); await current;
    f.reads[1].resolve(report({ totals: { reach: 999 } })); await stale;
    assert.equal(visibleMarketingReport(f.latest(), next)?.report?.totals.reach, 17);
    assert.equal(visibleMarketingReport(f.latest(), request), null);
    f.reader.dispose();
  }
});

test("clearing selection or unmounting aborts a request even if transport finishes parsing later", async () => {
  for (const action of ["clear", "dispose"] as const) for (const outcome of ["success", "failure"]) {
    const f = harness(); const pending = f.reader.load(request);
    f.reader[action]();
    const count = f.states.length;
    assert.equal(f.reads[0].signal.aborted, true);
    if (outcome === "success") f.reads[0].resolve(report()); else f.reads[0].reject(Error("Late rejection"));
    await pending;
    assert.equal(f.states.length, count);
    if (action === "clear") assert.equal(f.latest(), null);
    else { await f.reader.load(request); assert.equal(f.reads.length, 1); }
    f.reader.dispose();
  }
});

test("source discovery does not fetch a report or silently accept an unknown dataset", async () => {
  const signal = new AbortController().signal;
  const sources = [{ id: "profile-one", name: "Owned profile", dataset: "google_business_profile", status: "ready", lastSyncAt: null }];
  const result = await readMarketingSources(async (input, init) => {
    const url = new URL(String(input), "https://fixture.invalid");
    assert.equal(url.searchParams.has("selectionId"), false);
    assert.equal(url.searchParams.get("location"), "location-one");
    assert.equal(init?.cache, "no-store");
    return Response.json({ sources });
  }, "location-one", signal);
  assert.deepEqual(result, sources);
  await assert.rejects(readMarketingSources(async () => Response.json({ sources: [{ ...sources[0], dataset: "unrecognized" }] }), null, signal), /source list is incomplete/);
});

test("Business Profile summary keeps the latest original day, zero, missing series and reporting boundary", () => {
  const profile = report({ dataset: "google_business_profile", columns: [
    { key: "CALL_CLICKS", label: "Call clicks", unit: "count" },
    { key: "WEBSITE_CLICKS", label: "Website clicks", unit: "count" },
    { key: "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", label: "Mobile Search", unit: "count" },
  ], rows: [
    { label: "2026-09-28", values: { CALL_CLICKS: 0, BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 12 } },
    { label: "2026-09-27", values: { CALL_CLICKS: 8, WEBSITE_CLICKS: 16, BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 24 } },
    { label: "2026-09-30", values: { CALL_CLICKS: 999 } },
  ], totals: { CALL_CLICKS: 88 }, currency: null });
  const summary = marketingSourceSummary(profile);
  assert.equal(summary.date, "2026-09-28");
  assert.deepEqual(summary.metrics.map(metric => metric.value), [0, null, 12]);
  const html = renderToStaticMarkup(<MarketingSourceReportSummary report={profile}/>);
  assert.match(html, /Original daily measures for 2026-09-28/);
  assert.match(html, /Mobile Search impressions/);
  assert.match(html, /Website clicks<\/dt><dd>Not available/);
  assert.match(html, /Call clicks<\/dt><dd>0/);
  assert.match(html, /No device or date totals are combined/);
  assert.match(html, /do not confirm a lead/);
  assert.doesNotMatch(html, />88<|>999<|>36</);
});

test("Meta summary uses independent totals and account currency and states that leads are not included", () => {
  const meta = report({ warnings: ["Attribution setting unavailable"], truncated: true });
  assert.equal(marketingSourceSummary(meta).metrics[0].value, 90, "daily reach values must not be added");
  const html = renderToStaticMarkup(<MarketingSourceReportSummary report={meta}/>);
  assert.match(html, /Reach<\/dt><dd>90/);
  assert.match(html, /US\$25\.00/);
  assert.match(html, /Link clicks<\/dt><dd>3/);
  assert.match(html, /Meta lead counts are not included/);
  assert.match(html, /Attribution setting unavailable/);
  assert.match(html, /provider limited this response/);
  assert.doesNotMatch(html, /Reach<\/dt><dd>140|Leads<\/dt>/);
  const unknownCurrency = renderToStaticMarkup(<MarketingSourceReportSummary report={report({ currency: null })}/>);
  assert.match(unknownCurrency, /Currency unavailable/);
});

test("GA4 key events and Google Ads conversions remain distinct from recorded leads", () => {
  const analytics = report({ dataset: "google_analytics", columns: [{ key: "keyEvents", label: "Key events", unit: "count" }], totals: { keyEvents: 12 } });
  const ads = report({ dataset: "google_ads", columns: [{ key: "conversions", label: "Attributed conversions", unit: "count" }], totals: { conversions: 4.5 } });
  const ga4Html = renderToStaticMarkup(<MarketingSourceReportSummary report={analytics}/>);
  const adsHtml = renderToStaticMarkup(<MarketingSourceReportSummary report={ads}/>);
  assert.match(ga4Html, /Key events<\/dt><dd>12/); assert.match(ga4Html, /Lead events are not separately identified/);
  assert.match(adsHtml, /Attributed conversions<\/dt><dd>4\.5/); assert.match(adsHtml, /conversion is not necessarily a lead/);
  assert.doesNotMatch(ga4Html + adsHtml, /Leads<\/dt>/);
});

test("overview starts with a source read status and report timestamps are stable in every user timezone", () => {
  const html = renderToStaticMarkup(<MarketingSourceOverview locationId="north" onReport={() => {}} onConnections={() => {}} onJourneys={() => {}}/>);
  assert.match(html, /Loading the reporting sources available for this location/);
  assert.match(html, /Recorded journey leads come from lead or phone-call events/);
  assert.doesNotMatch(html, /<dd>0<\/dd>|Live data/);
  const previousTimezone = process.env.TZ;
  try {
    for (const timezone of ["UTC", "America/Denver", "Asia/Tokyo"]) {
      process.env.TZ = timezone;
      assert.match(renderToStaticMarkup(<MarketingSourceReportSummary report={report()}/>), /Fetched 2026-09-30 01:02 UTC/);
      assert.match(renderToStaticMarkup(<MarketingReportBody report={report()}/>), /Fetched 2026-09-30 01:02 UTC/);
    }
  } finally { if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone; }
});
