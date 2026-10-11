import type { MarketingReport, ReportDataset } from "./marketing-reporting";

export const marketingLeadCoverage: Record<ReportDataset, string> = {
  google_analytics: "GA4 key events depend on the property's event setup. Lead events are not separately identified in this view. Use the daily report to check configured generate_lead events.",
  google_search_console: "Search clicks are interactions with search results. This report does not count leads.",
  google_business_profile: "Call clicks, website clicks and direction requests are profile interactions. They do not confirm a lead, completed call or visit.",
  google_ads: "Attributed conversions depend on this Google Ads account's conversion setup. A conversion is not necessarily a lead.",
  meta_ads: "This Meta report includes ad activity and spend. Meta lead counts are not included in this report.",
};

export function marketingLeadCoverageForReport(report: MarketingReport) {
  return report.dataset === "google_analytics" && report.columns.some(column => column.key === "leadEvents")
    ? "Lead events count exact generate_lead occurrences across this property's traffic sources. Website or app event tagging is required. These are event counts, not unique people, qualified leads or leads attributed only to Google ads. Keep them separate from key events and recorded journey leads."
    : marketingLeadCoverage[report.dataset];
}

/** GBP stays in original daily series; other datasets use independent provider totals. */
export function marketingSourceSummary(report: MarketingReport) {
  const profile = report.dataset === "google_business_profile";
  const latest = profile && report.view === "daily" ? report.rows.filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.label) && row.label >= report.period.start && row.label <= report.period.end).sort((a, b) => b.label.localeCompare(a.label))[0] : null;
  const values = profile ? latest?.values ?? {} : report.totals;
  return {
    date: latest?.label ?? null,
    basis: profile ? latest ? `Original daily measures for ${latest.label}` : "No daily profile measures returned" : "Provider-reported period totals",
    metrics: report.columns.map(column => ({
      column: profile && column.key.startsWith("BUSINESS_IMPRESSIONS_") ? { ...column, label: `${column.label} impressions` } : column,
      value: Number.isFinite(values[column.key]) ? values[column.key] : null,
    })),
    leadCoverage: marketingLeadCoverageForReport(report),
  };
}
