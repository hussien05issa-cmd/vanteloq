/** Shared reporting contract. Provider totals, people and rates are never interchangeable. */
export type ReportDataset = "google_analytics" | "google_search_console" | "google_business_profile" | "google_ads" | "meta_ads";
export type ReportView = "daily" | "channels" | "pages" | "devices" | "queries" | "realtime" | "keywords" | "campaigns" | "platforms";
export type ReportColumn = { key: string; label: string; unit: "count" | "percent" | "position" | "currency" };
export type ReportRow = { label: string; values: Record<string, number | null>; note?: string };
export type MarketingReport = {
  dataset: ReportDataset;
  view: ReportView;
  period: { start: string; end: string };
  previousPeriod: { start: string; end: string } | null;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: Record<string, number | null>;
  previous: Record<string, number | null> | null;
  currency: string | null;
  timeZone: string;
  fetchedAt: string;
  warnings: string[];
  limitations: string[];
  truncated: boolean;
};
export type ReportSource = { id: string; dataset: ReportDataset; name: string; status: string; lastSyncAt: string | null };

export const REPORT_VIEWS: Record<ReportDataset, readonly ReportView[]> = {
  google_analytics: ["daily", "channels", "pages", "devices", "realtime"],
  google_search_console: ["daily", "queries", "pages", "devices"],
  google_business_profile: ["daily", "keywords"],
  google_ads: ["daily", "campaigns"],
  meta_ads: ["daily", "campaigns", "platforms"],
};
export const REPORT_NAMES: Record<ReportDataset, string> = {
  google_analytics: "Website traffic", google_search_console: "Search performance",
  google_business_profile: "Local discovery", google_ads: "Google Ads", meta_ads: "Meta advertising",
};

export function finiteMetric(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const n = typeof value === "number" ? value : typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER ? n : null;
}
export function metricRatio(numerator: number | null, denominator: number | null, scale = 1) {
  return numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator * scale : null;
}
export function metricChange(current: number | null, previous: number | null) {
  return current !== null && previous !== null && previous > 0 ? (current - previous) / previous * 100 : null;
}
export function reportingWindow(days: number, now = new Date(), lagDays = 1) {
  if (![7, 28, 90].includes(days) || !Number.isFinite(now.getTime())) throw new Error("Choose a 7, 28 or 90 day report.");
  const day = 86_400_000;
  const endTime = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - lagDays * day;
  const date = (n: number) => new Date(n).toISOString().slice(0, 10);
  const startTime = endTime - (days - 1) * day;
  return { period: { start: date(startTime), end: date(endTime) }, previousPeriod: { start: date(startTime - days * day), end: date(startTime - day) } };
}

export function reportSuggestions(report: MarketingReport): Array<{ title: string; detail: string }> {
  if (report.truncated || report.warnings.length) return [{ title: "Check the reporting limits first", detail: "This response is limited or incomplete. Review its source warnings before making a budget or content decision." }];
  if (report.dataset === "google_search_console" && report.view === "queries") {
    return report.rows.filter((row) => (row.values.impressions ?? 0) >= 100 && (row.values.position ?? 0) > 3 && (row.values.position ?? 100) <= 20)
      .sort((a, b) => (b.values.impressions ?? 0) - (a.values.impressions ?? 0)).slice(0, 3).map((row) => ({
        title: `Review content for “${row.label}”`,
        detail: `${row.values.impressions?.toLocaleString("en-CA")} impressions; average position ${row.values.position?.toFixed(1)}. Check whether the ranking page answers the search intent, then review its title and internal links. This is a review rule, not a ranking or traffic forecast.`,
      }));
  }
  if (report.dataset === "google_analytics" && report.view === "channels") {
    return report.rows.filter((row) => (row.values.sessions ?? 0) >= 100 && (row.values.engagementRate ?? 100) < 40).slice(0, 3).map((row) => ({
      title: `Review the ${row.label} landing experience`, detail: "This channel has at least 100 sessions and an engagement rate below the review threshold of 40%. Check campaign intent, page speed and the landing page. The threshold is a triage rule, not an industry benchmark.",
    }));
  }
  return [];
}

/** No queries, URLs, customer records, GBP content or unknown-currency amounts enter AI evidence. */
export function marketingEvidenceSummary(rows: Array<{ selectionId: string; dataset: string; metricDate: string; metricKey: string; valueMilli: number }>, now = new Date()) {
  const windows = reportingWindow(28, now, 3);
  const allowed: Record<string, string[]> = {
    google_analytics: ["analytics_sessions", "analytics_engaged_sessions", "analytics_page_views", "analytics_key_events"],
    google_search_console: ["search_clicks", "search_impressions", "search_position"],
    meta_ads: ["meta_impressions", "meta_clicks", "meta_link_clicks"],
    google_ads: ["google_ads_impressions", "google_ads_clicks", "google_ads_conversions"],
  };
  const sources = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!allowed[row.dataset]?.includes(row.metricKey) || row.metricDate < windows.previousPeriod.start || row.metricDate > windows.period.end || !Number.isSafeInteger(row.valueMilli) || row.valueMilli < 0) continue;
    const key = `${row.dataset}:${row.selectionId}`;
    const items = sources.get(key) ?? [];
    items.push(row);
    sources.set(key, items);
  }
  return { ...windows, sources: [...sources.entries()].slice(0, 20).map(([, items], index) => {
    const summarize = (start: string, end: string) => {
      const selected = items.filter((row) => row.metricDate >= start && row.metricDate <= end);
      const datesFor = (key: string) => selected.filter((row) => row.metricKey === key).map((row) => row.metricDate).sort();
      const matchedRatio = (first: string, second: string) => {
        const firstDates = datesFor(first), secondDates = datesFor(second);
        return firstDates.length > 0 && JSON.stringify(firstDates) === JSON.stringify(secondDates) ? metricRatio(sum(first), sum(second), 100) : null;
      };
      const sum = (key: string) => {
        const matches = selected.filter((row) => row.metricKey === key);
        return matches.length ? matches.reduce((total, row) => total + row.valueMilli / 1000, 0) : null;
      };
      const values: Record<string, number | null> = Object.fromEntries(allowed[items[0].dataset].filter((key) => key !== "search_position").map((key) => [key, sum(key)]));
      if (items[0].dataset === "google_search_console") {
        values.search_ctr_percent = matchedRatio("search_clicks", "search_impressions");
        let weighted = 0, impressions = 0;
        const impressionsByDate = new Map(selected.filter((r) => r.metricKey === "search_impressions").map((r) => [r.metricDate, r.valueMilli]));
        for (const row of selected.filter((r) => r.metricKey === "search_position")) {
          const count = impressionsByDate.get(row.metricDate);
          if (count !== undefined) { weighted += row.valueMilli / 1000 * count; impressions += count; }
        }
        values.average_position = impressions > 0 ? weighted / impressions : null;
      }
      if (items[0].dataset === "google_analytics") values.engagement_rate_percent = matchedRatio("analytics_engaged_sessions", "analytics_sessions");
      const metricObservedDays = Object.fromEntries(allowed[items[0].dataset].map((key) => [key, new Set(datesFor(key)).size]));
      return { observedDays: new Set(selected.map((row) => row.metricDate)).size, metricObservedDays, values };
    };
    const current = summarize(windows.period.start, windows.period.end);
    const previous = summarize(windows.previousPeriod.start, windows.previousPeriod.end);
    return { source: `Marketing source ${index + 1}`, dataset: items[0].dataset, latestDate: items.map((row) => row.metricDate).sort().at(-1), current, previous, comparisonComplete: Object.values(current.metricObservedDays).every((days) => days === 28) && Object.values(previous.metricObservedDays).every((days) => days === 28) };
  }), truncated: sources.size > 20, limitations: ["Sources remain separate. No cross-platform attribution or causal claim.", "Missing days are not zero. Only compare complete, matching windows.", "Currency amounts and Business Profile content are excluded from this AI summary.", ...(sources.size > 20 ? ["Only the first 20 permitted sources fit in this evidence summary. Do not infer whole-business totals."] : [])] };
}
