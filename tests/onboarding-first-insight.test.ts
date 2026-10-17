import assert from "node:assert/strict";
import test from "node:test";
import { buildOnboardingFirstInsight, onboardingBusinessDate, onboardingPreviewCurrencyIssue, ONBOARDING_CSV_MAX_BYTES, parseOnboardingSourceCsv } from "../domain/onboarding-first-insight";
import { validateOnboardingDraft } from "../domain/onboarding-draft";
import { defaultIndustryConfiguration } from "../domain/industry-templates";
import { recommendedOverview } from "../domain/dashboard-personalization";

const header = "business_date,gross_sales,net_sales,cogs,transactions,units";
const options = { fileName: "owner-sales.csv", currency: "CAD", timeZone: "America/Edmonton" };
const now = new Date("2026-09-16T18:00:00Z");
const day = (number: number) => `2026-09-${String(number).padStart(2, "0")}`;
const row = (date: string, net = "100.00", suffix = "") => `${date},120.00,${net},30.00,2,3${suffix}`;
const preview = (csv: string) => parseOnboardingSourceCsv(csv, options);

test("the first insight preserves exact cents and physical source lines, including blank lines and BOM", () => {
  const source = preview(`\uFEFF\n${header},discounts,refunds\n\n${row(day(1), "110.11", ",9.89,0.00")}\n${row(day(2), "105.01", ",14.99,0.00")}`);
  assert.deepEqual(source.records.map(record => record.sourceLine), [4, 5]);
  const insight = buildOnboardingFirstInsight(source, "all", now);
  assert.equal(insight.kind, "discounts");
  if (insight.kind !== "discounts") return;
  assert.equal(insight.discountsCents, 2488);
  assert.equal(insight.grossSalesCents, 24000);
  assert.equal(insight.discountRate, 2488 / 24000 * 100);
  assert.deepEqual(insight.records.map(record => record.sourceLine), [4, 5]);
});

test("absent or blank discount values do not become a zero-discount insight", () => {
  for (const csv of [`${header}\n${row(day(1))}`, `${header},discounts\n${row(day(1), "100", ",")}`, `${header},discounts\n${row(day(1), "100", ",1.00")}\n${row(day(2), "100", ",")}`]) {
    const insight = buildOnboardingFirstInsight(preview(csv), "all", now);
    assert.equal(insight.kind, "recorded_sales");
  }
  const zero = buildOnboardingFirstInsight(preview(`${header},discounts\n${row(day(1), "100", ",0")}`), "all", now);
  assert.equal(zero.kind, "discounts");
  if (zero.kind === "discounts") assert.equal(zero.discountsCents, 0);
});

test("two fully covered periods use the supplied net sales once and identify the greatest daily decline", () => {
  const rows = Array.from({ length: 14 }, (_, index) => row(day(index + 1), index < 7 ? "100.11" : index === 8 ? "50.01" : "90.11", ",20,5"));
  const insight = buildOnboardingFirstInsight(preview(`${header},discounts,refunds\n${rows.join("\n")}`), "all", now);
  assert.equal(insight.kind, "comparison");
  if (insight.kind !== "comparison") return;
  assert.equal(insight.previousCents, 70077);
  assert.equal(insight.currentCents, 59067);
  assert.equal(insight.changeCents, -11010);
  assert.equal(insight.previousFrom, day(1)); assert.equal(insight.previousTo, day(7));
  assert.equal(insight.from, day(8)); assert.equal(insight.to, day(14));
  assert.equal(insight.changePercent, -11010 / 70077 * 100);
  assert.deepEqual(insight.largestDay, { currentDate: day(9), previousDate: day(2), currentCents: 5001, previousCents: 10011, changeCents: -5010 });
  assert.equal(insight.records.length, 14);
});

test("a missing day withholds a period comparison while an explicit zero day provides coverage", () => {
  const rows = Array.from({ length: 14 }, (_, index) => row(day(index + 1), index === 4 ? "0" : "100"));
  const complete = buildOnboardingFirstInsight(preview(`${header}\n${rows.join("\n")}`), "all", now);
  assert.equal(complete.kind, "comparison");
  const incomplete = buildOnboardingFirstInsight(preview(`${header}\n${rows.filter((_, index) => index !== 4).join("\n")}`), "all", now);
  assert.equal(incomplete.kind, "recorded_sales");
  assert.deepEqual(incomplete.missingComparisonDates, [day(5)]);
});

test("zero and negative previous sales keep exact dollar movement and withhold percentages", () => {
  for (const previous of ["0", "-1.01"]) {
    const rows = Array.from({ length: 14 }, (_, index) => row(day(index + 1), index < 7 ? previous : "2.02"));
    const insight = buildOnboardingFirstInsight(preview(`${header}\n${rows.join("\n")}`), "all", now);
    assert.equal(insight.kind, "comparison");
    if (insight.kind === "comparison") { assert.equal(insight.changePercent, null); assert.equal(insight.currentCents, 1414); }
  }
});

test("multiple locations and all-location summaries never double count", () => {
  const source = preview(`${header},location\n${row(day(1), "10", ",all")}\n${row(day(1), "7", ",Shop A")}\n${row(day(1), "3", ",Shop B")}`);
  for (const [location, amount] of [["all", 1000], ["Shop A", 700], ["Shop B", 300]] as const) {
    const insight = buildOnboardingFirstInsight(source, location, now);
    assert.equal(insight.kind, "recorded_sales");
    if (insight.kind === "recorded_sales") assert.equal(insight.netSalesCents, amount);
    assert.equal(insight.records.length, 1);
  }
  assert.throws(() => buildOnboardingFirstInsight(source, "missing", now), /location present/);
});

test("source currency and timezone are explicitly checked without conversion", () => {
  assert.throws(() => preview(`${header},currency\n${row(day(1), "10", ",USD")}`), /currency must match CAD/);
  assert.throws(() => preview(`${header},currency\n${row(day(1), "10", ",CAD")}\n${row(day(2), "10", ",")}`), /Row 3: currency/);
  assert.throws(() => preview(`${header},reporting_timezone\n${row(day(1), "10", ",UTC")}`), /must match America\/Edmonton/);
  const source = preview(`${header},currency,timezone\n${row(day(1), "10", ",CAD,America/Edmonton")}`);
  assert.equal(source.records[0].businessDate, day(1));
  assert.throws(() => parseOnboardingSourceCsv(`${header}\n${row(day(1))}`, { ...options, timeZone: "Invalid/Timezone" }), /Location & Hours/);
});

test("zero- and three-decimal currencies cannot enter the fixed-cent preview", () => {
  const csv = `${header}\n${row(day(1), "10.01")}`;
  for (const [currency, digits] of [["JPY", 0], ["KWD", 3]] as const) {
    assert.equal(Intl.supportedValuesOf("currency").includes(currency), true);
    assert.match(onboardingPreviewCurrencyIssue(currency)!, new RegExp(`${currency} uses ${digits} decimal places`));
    assert.throws(() => parseOnboardingSourceCsv(csv, { ...options, currency }), new RegExp(`${currency} uses ${digits} decimal places`));
    const tamperedSource = { ...preview(csv), currency };
    assert.throws(() => buildOnboardingFirstInsight(tamperedSource, "all", now), /supports currencies with 2 decimal places/);
  }
  assert.throws(() => parseOnboardingSourceCsv(`${header}\n${row(day(1), "10.001")}`, { ...options, currency: "KWD" }), /KWD uses 3 decimal places/);
  assert.equal(onboardingPreviewCurrencyIssue("CAD"), null);
  assert.equal(onboardingPreviewCurrencyIssue("USD"), null);
  assert.equal(preview(csv).records[0].netSalesCents, 1001);
});

test("unknown alphabetic currency codes are rejected even though Intl defaults them to two digits", () => {
  for (const currency of ["AAA", "ZZZ"]) {
    assert.equal(new Intl.NumberFormat("en-CA", { style: "currency", currency }).resolvedOptions().maximumFractionDigits, 2);
    assert.equal(Intl.supportedValuesOf("currency").includes(currency), false);
    assert.match(onboardingPreviewCurrencyIssue(currency)!, /not a recognized currency/);
    assert.throws(() => parseOnboardingSourceCsv(`${header}\n${row(day(1), "10.01")}`, { ...options, currency }), /not a recognized currency/);
  }
});

test("a browser without currency discovery withholds the preview rather than guessing precision", context => {
  context.mock.method(Intl, "supportedValuesOf", () => { throw new Error("unsupported browser"); });
  assert.match(onboardingPreviewCurrencyIssue("CAD")!, /verification is unavailable/);
  assert.throws(() => preview(`${header}\n${row(day(1), "10.01")}`), /verification is unavailable/);
});

test("current and future dates cannot inflate the first completed-period insight", () => {
  const source = preview(`${header}\n${row(day(15), "10")}\n${row(day(16), "1000")}\n${row(day(17), "2000")}`);
  const insight = buildOnboardingFirstInsight(source, "all", now);
  assert.equal(insight.kind, "recorded_sales");
  if (insight.kind === "recorded_sales") assert.equal(insight.netSalesCents, 1000);
  assert.equal(insight.excludedCurrentOrFutureRows, 2);
  assert.deepEqual(insight.records.map(record => record.businessDate), [day(15)]);
  const unfinished = buildOnboardingFirstInsight(preview(`${header}\n${row(day(16), "1000")}`), "all", now);
  assert.equal(unfinished.kind, "incomplete_day");
  assert.equal(unfinished.completeDays, 0);
});

test("source business dates remain stable while the local current date follows UTC, Denver and Tokyo", () => {
  const instant = new Date("2026-09-16T01:00:00Z");
  assert.equal(onboardingBusinessDate(instant, "UTC"), day(16));
  assert.equal(onboardingBusinessDate(instant, "America/Denver"), day(15));
  assert.equal(onboardingBusinessDate(instant, "Asia/Tokyo"), day(16));
  for (const [timeZone, excluded] of [["UTC", 1], ["America/Denver", 2], ["Asia/Tokyo", 1]] as const) {
    const source = parseOnboardingSourceCsv(`${header}\n${row(day(14))}\n${row(day(15))}\n${row(day(16))}`, { ...options, timeZone });
    const insight = buildOnboardingFirstInsight(source, "all", instant);
    assert.equal(insight.excludedCurrentOrFutureRows, excluded);
    assert.deepEqual(source.records.map(record => record.businessDate), [day(14), day(15), day(16)]);
  }
});

test("preview rejects excessive sizes, Free record counts, duplicated records and invalid dates", () => {
  assert.throws(() => preview("x".repeat(ONBOARDING_CSV_MAX_BYTES + 1)), /256 KiB/);
  assert.throws(() => preview(`${header},location\n${row(day(1), "10", ",Shop\u0000")}`), /UTF-8 CSV/);
  assert.throws(() => preview(`${header},location\n${row(day(1), "10", ",Shop\ufffd")}`), /UTF-8 CSV/);
  const rows = Array.from({ length: 101 }, (_, index) => row(new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10)));
  assert.throws(() => parseOnboardingSourceCsv(`${header}\n${rows.join("\n")}`, { ...options, maxRows: 100 }), /no more than 100/);
  assert.equal(parseOnboardingSourceCsv(`${header}\n${rows.slice(0, 100).join("\n")}`, { ...options, maxRows: 100 }).records.length, 100);
  assert.throws(() => preview(`${header}\n${row(day(1))}\n${row(day(1))}`), /already appear/);
  assert.throws(() => preview(`${header}\n${row("2026-02-30")}`), /valid date/);
  assert.throws(() => parseOnboardingSourceCsv(`${header}\n${row(day(1))}`, { ...options, fileName: "sales.txt" }), /\.csv extension/);
});

test("combined financial amounts cannot silently exceed exact integer arithmetic", () => {
  const source = preview(`${header}\n${row(day(1), "90071992547400.00")}\n${row(day(2), "90071992547400.00")}`);
  assert.throws(() => buildOnboardingFirstInsight(source, "all", now), /too large to calculate exactly/);
});

test("pre-workspace saved drafts cannot retain local financial source previews or confirmations", () => {
  const source = preview(`${header}\n${row(day(1), "110.11")}`);
  const keys = ["ownerName", "businessName", "legalName", "businessEmail", "phone", "website", "country", "province", "city", "address", "postalCode", "timezone", "currency", "fiscalYearStart", "sourceMode", "selectedPos"];
  const form = Object.fromEntries(keys.map(key => [key, ""]));
  const draft = validateOnboardingDraft({ form, step: 5, hours: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(day => ({ day, open: "09:00", close: "17:00", closed: false })), industryConfiguration: defaultIndustryConfiguration("Retail"), overview: recommendedOverview("Retail"), sourcePreview: { source, reportingConfirmed: true } });
  assert.equal("sourcePreview" in draft, false);
  assert.doesNotMatch(JSON.stringify(draft), /11011|owner-sales\.csv|reportingConfirmed|sourceLine/);
});
