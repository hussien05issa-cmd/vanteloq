import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCampaignLink, isCalendarDate, isGrowthTimestamp } from "../domain/marketing-workbench";
import { buildGrowthIntelligence, buildJourneyCoverage, comparableSearchSeries, type GrowthTouchpoint } from "../domain/growth-intelligence";
import MarketingWorkbench, { JourneyCoverageCard } from "../app/marketing-workbench";
import { MarketingReportBody } from "../app/marketing-reporting";
import type { MarketingReport } from "../domain/marketing-reporting";

const validLink = { destination: "https://example.com/shop?category=retail#offer", source: "Instagram", medium: "Social", campaign: "Autumn Launch", content: "video_1" };
test("campaign links normalize labels and preserve the landing page", () => {
  const result = buildCampaignLink(validLink); assert.equal(result.error, null);
  const url = new URL(result.url!); assert.equal(url.searchParams.get("category"), "retail"); assert.equal(url.searchParams.get("utm_campaign"), "autumn_launch"); assert.equal(url.searchParams.get("utm_source"), "instagram"); assert.equal(url.hash, "#offer");
});
test("campaign updates are deterministic and remove an old creative label", () => {
  const url = buildCampaignLink(validLink).url!;
  const result = buildCampaignLink({ ...validLink, destination: url, source: "newsletter", content: "" });
  assert.equal(new URL(result.url!).searchParams.getAll("utm_source").length, 1);
  assert.equal(new URL(result.url!).searchParams.has("utm_content"), false);
});
test("campaign builder rejects unsafe schemes, credentials and common private URL values", () => {
  for (const destination of ["javascript:alert(1)", "data:text/html,test", "http://example.com", "https://user:password@example.com", "https://example.com/reset?token=test", "https://example.com/?email=a%40example.com", "https://example.com/user/a%40example.com", "https://localhost/"]) assert.ok(buildCampaignLink({ ...validLink, destination }).error, destination);
});
test("campaign labels reject missing values, personal addresses and unbounded inputs", () => {
  for (const campaign of ["", "me@example.com", "<script>", "a".repeat(81)]) assert.ok(buildCampaignLink({ ...validLink, campaign }).error);
});
test("campaign links reject local addresses and recovery fragments while allowing ordinary anchors", () => {
  for (const destination of ["https://127.0.0.1/", "https://192.168.1.2/", "https://172.20.0.1/", "https://office.internal/", "https://example.com/#access_token=fixture", "https://example.com/#user=private%40example.com"]) assert.ok(buildCampaignLink({ ...validLink, destination }).error, destination);
  assert.equal(buildCampaignLink({ ...validLink, destination: "https://example.com/#offer" }).error, null);
});
test("calendar validator handles leap years and impossible dates", () => {
  assert.equal(isCalendarDate("2028-02-29"), true);
  for (const value of ["2026-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-9-08"]) assert.equal(isCalendarDate(value), false, value);
});
test("record timestamp validation rejects normalized-overflow times and dates", () => {
  assert.equal(isGrowthTimestamp("2026-09-08T12:30:45.123Z"), true);
  assert.equal(isGrowthTimestamp("2026-09-08"), true);
  for (const value of ["2026-02-30T12:00:00Z", "2026-09-08T24:00:00Z", "2026-09-08T10:61:00Z", "2026-09-08T10:00:00+03:00", "not-a-date"]) assert.equal(isGrowthTimestamp(value), false, value);
});
const points: GrowthTouchpoint[] = [
  { id: "p1", occurredAt: "2026-09-01T11:00:00.000Z", journeyRef: "j1", stage: "discovery", source: "google" },
  { id: "p2", occurredAt: "2026-09-01T11:10:00Z", journeyRef: "j1", stage: "website", source: "google" },
  { id: "p3", occurredAt: "2026-09-01T11:20:00Z", journeyRef: "j1", stage: "website", source: "google" },
  { id: "p4", occurredAt: "2026-09-01T12:00:00Z", journeyRef: "j2", stage: "lead", source: "email" },
];
const transactions = [
  { id: "t0", occurredAt: "2026-09-01T09:00:00Z", journeyRef: "j1", revenueCents: 900, grossProfitCents: 400 },
  { id: "t1", occurredAt: "2026-09-01T13:00:00Z", journeyRef: "j1", revenueCents: 200, grossProfitCents: null },
  { id: "t2", occurredAt: "2026-09-01T14:00:00Z", journeyRef: "orphan", revenueCents: 700, grossProfitCents: 200 },
];
test("journey counts deduplicate stage visits and expose unmatched evidence without identifiers", () => {
  const result = buildJourneyCoverage(points, transactions);
  assert.deepEqual(result, { journeys: 2, stages: { discovery: 1, website: 1, contact: 1, customer: 0, purchase: 1 }, matchedTransactions: 1, unmatchedTransactions: 2 });
  assert.doesNotMatch(JSON.stringify(result), /j1|j2|orphan/);
});
test("first-touch attribution excludes sales before the touchpoint and preserves missing cost", () => {
  const result = buildGrowthIntelligence({ touchpoints: points, transactions, searchVisibility: [] });
  assert.equal(result.channels[0].revenueCents, 200); assert.equal(result.channels[0].transactions, 1); assert.equal(result.channels[0].grossProfitCents, null);
});
test("timestamp comparison is chronological rather than lexicographic", () => {
  const result = buildGrowthIntelligence({ touchpoints: [{ ...points[0], occurredAt: "2026-09-01T11:00:00.500Z", source: "later" }, { ...points[0], occurredAt: "2026-09-01T11:00:00Z", source: "earlier" }], transactions, searchVisibility: [] });
  assert.equal(result.channels[0].source, "earlier");
});
test("search insight never compares different queries or sources", () => {
  const visibility = [{ query: "retail", observedDate: "2026-09-01", position: 3, sourceSystem: "export-a", discoveryActions: null }, { query: "coffee", observedDate: "2026-09-02", position: 20, sourceSystem: "export-a", discoveryActions: null }, { query: "retail", observedDate: "2026-09-03", position: 6, sourceSystem: "export-b", discoveryActions: null }];
  assert.equal(buildGrowthIntelligence({ touchpoints: points, transactions, searchVisibility: visibility }).insight, null);
  visibility.push({ ...visibility[0], observedDate: "2026-09-04", position: 2 });
  assert.match(buildGrowthIntelligence({ touchpoints: points, transactions, searchVisibility: visibility }).insight!.title, /position 3 to 2/);
});
test("duplicate date snapshots are excluded rather than joined or silently averaged", () => {
  const a = { query: "retail", observedDate: "2026-09-01", position: 2, sourceSystem: "owner" };
  assert.deepEqual(comparableSearchSeries([a, { ...a, position: 20 }]), []);
});
test("workbench distinguishes drafting from publishing and permits no write for read-only viewers", () => {
  const html = renderToStaticMarkup(<MarketingWorkbench canManage={false} website="" onPlan={() => {}} onReports={() => {}}/>);
  assert.match(html, /Nothing is saved or published yet/); assert.match(html, /not a live platform-change feed/); assert.match(html, /disabled="">Review calendar draft/); assert.match(html, /No tracking is installed or sent/);
});
test("journey empty state does not invent a conversion funnel", () => {
  const html = renderToStaticMarkup(<JourneyCoverageCard coverage={null} period={{ since: "2026-08-01", through: "2026-09-08" }} onImport={() => {}}/>);
  assert.match(html, /Organization-wide access required/); assert.match(html, /not a conversion funnel/); assert.doesNotMatch(html, /100%/);
});
test("report actions expose a review step only when explicitly enabled", () => {
  const report: MarketingReport = { dataset: "google_analytics", view: "channels", period: { start: "2026-08-01", end: "2026-08-28" }, previousPeriod: null, columns: [], rows: [{ label: "Paid Social", values: { sessions: 200, engagementRate: 30 } }], totals: {}, previous: null, currency: null, timeZone: "UTC", fetchedAt: "2026-09-01T12:00:00Z", warnings: [], limitations: [], truncated: false };
  assert.match(renderToStaticMarkup(<MarketingReportBody report={report} onPlan={() => {}}/>), /Plan this action/);
  assert.doesNotMatch(renderToStaticMarkup(<MarketingReportBody report={report}/>), /Plan this action/);
});
