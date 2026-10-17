import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import OnboardingFirstInsight, { OnboardingInsightResult } from "../app/onboarding-first-insight";
import { buildOnboardingFirstInsight, parseOnboardingSourceCsv } from "../domain/onboarding-first-insight";

const header = "business_date,gross_sales,net_sales,cogs,transactions,units";
const source = parseOnboardingSourceCsv(`${header}\n\n2026-09-01,120.10,110.11,30.00,2,3`, { fileName: "owner-sales.csv", currency: "CAD", timeZone: "America/Edmonton" });
const now = new Date("2026-09-16T18:00:00Z");

test("optional preview uses a labelled native file control and explains local retention and exact limits", () => {
  const html = renderToStaticMarkup(<OnboardingFirstInsight currency="CAD" timeZone="America/Edmonton" maxRows={100} value={null} onChange={() => {}}/>);
  assert.match(html, /type="file"/); assert.match(html, /accept="\.csv,text\/csv"/);
  assert.match(html, /Daily-summary CSV/); assert.match(html, /Maximum 100 supported daily records and 256 KiB/);
  assert.match(html, /aria-describedby=/); assert.match(html, /not uploaded or sent to AI/);
  assert.match(html, /reselect your CSV when you resume/);
  assert.doesNotMatch(html, /Your file records|checked=""|type="file"[^>]*required/);
});

test("financial findings wait for owner confirmation of reporting currency and business dates", () => {
  const unconfirmed = renderToStaticMarkup(<OnboardingFirstInsight currency="CAD" timeZone="America/Edmonton" maxRows={100} value={{ source, locationRef: "all", reportingConfirmed: false }} onChange={() => {}}/>);
  assert.match(unconfirmed, /1 daily record checked\. No rows imported/);
  assert.doesNotMatch(unconfirmed, /Your file records CAD/);
  assert.match(unconfirmed, /I confirm the source amounts use CAD/);
  const mismatched = renderToStaticMarkup(<OnboardingFirstInsight currency="USD" timeZone="America/Edmonton" maxRows={100} value={{ source, locationRef: "all", reportingConfirmed: true }} onChange={() => {}}/>);
  assert.match(mismatched, /Your reporting settings or available record limit changed/);
  assert.doesNotMatch(mismatched, /Your file records CAD|checked=""/);
});

test("JPY, KWD and unknown currencies clearly withhold the optional preview while setup remains available", () => {
  for (const [currency, expected] of [["JPY", /JPY uses 0 decimal places/], ["KWD", /KWD uses 3 decimal places/], ["AAA", /AAA is not a recognized currency/]] as const) {
    const html = renderToStaticMarkup(<OnboardingFirstInsight currency={currency} timeZone="America/Edmonton" maxRows={100} value={{ source: { ...source, currency }, locationRef: "all", reportingConfirmed: true }} onChange={() => {}}/>);
    assert.match(html, expected);
    assert.match(html, /You can continue setup without a preview/);
    assert.match(html, /type="file"[^>]*disabled=""/);
    assert.match(html, /type="checkbox"[^>]*disabled=""/);
    assert.doesNotMatch(html, /Your file records|checked=""|type="file"[^>]*required/);
    const unguardedResult = renderToStaticMarkup(<OnboardingInsightResult source={{ ...source, currency }} insight={buildOnboardingFirstInsight(source, "all", now)} locationRef="all"/>);
    assert.match(unguardedResult, /CSV preview unavailable for this currency/);
    assert.doesNotMatch(unguardedResult, /110\.11/);
  }
});

test("a real source finding exposes exact contributing rows and missing fields with accessible table semantics", () => {
  const html = renderToStaticMarkup(<OnboardingInsightResult source={source} insight={buildOnboardingFirstInsight(source, "all", now)} locationRef="all"/>);
  assert.match(html, /Your file records CAD(?:&nbsp;|\u00a0)110\.11 in net sales/);
  assert.match(html, /Source: owner-sales\.csv/);
  assert.match(html, /<th scope="row">3<\/th>/);
  assert.match(html, /2026-09-01/); assert.match(html, /Not supplied/);
  assert.match(html, /<caption>/); assert.match(html, /scope="col"/);
  assert.match(html, /role="region" aria-label="Contributing CSV records" tabindex="0"/);
  assert.match(html, /without subtracting refunds or discounts a second time/);
  assert.match(html, /not created financial records/);
});

test("sales-period comparisons show actual amounts, dates, calculation and review action", () => {
  const rows = Array.from({ length: 14 }, (_, index) => `2026-09-${String(index + 1).padStart(2, "0")},120,${index < 7 ? "100.11" : "90.11"},30,2,3`);
  const fullSource = parseOnboardingSourceCsv(`${header}\n${rows.join("\n")}`, { fileName: "own-sales.csv", currency: "CAD", timeZone: "UTC" });
  const html = renderToStaticMarkup(<OnboardingInsightResult source={fullSource} insight={buildOnboardingFirstInsight(fullSource, "all", now)} locationRef="all"/>);
  assert.match(html, /fell by CAD(?:&nbsp;|\u00a0)70\.00/);
  assert.match(html, /2026-09-01 to 2026-09-07/);
  assert.match(html, /2026-09-08 to 2026-09-14/);
  assert.match(html, /Show the records \(14\)/);
  assert.match(html, /Check the underlying sales before changing hours/);
  assert.match(html, /does not establish its cause/);
});
