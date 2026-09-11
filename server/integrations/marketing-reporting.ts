import { getRuntimeEnv } from "../../db";
import { ApiError } from "../api";
import { finiteMetric, metricRatio, REPORT_VIEWS, reportingWindow, type MarketingReport, type ReportColumn, type ReportRow, type ReportView } from "../../domain/marketing-reporting";
import type { SelectedMarketingResource } from "./marketing";
import { googleAdsHeaders, googleAdsVersion, resolveGoogleAdsAccount } from "./google-ads-access";

const LIMIT = 250;
const column = (key: string, label: string, unit: ReportColumn["unit"] = "count"): ReportColumn => ({ key, label, unit });
type Period = { start: string; end: string };

async function providerReport<T>(url: string, token: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store",
    headers: { ...extraHeaders, Authorization: `Bearer ${token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ApiError(response.status === 429 ? 429 : 502, "MARKETING_REPORT_UNAVAILABLE", response.status === 429 ? "The provider is limiting reporting requests. Wait before refreshing." : "The provider could not return this report. Check the selected account, API permissions and provider setup in Integrations.");
  }
  // Reports are bounded at the provider and locally; never return provider error bodies or tokens.
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(502, "MARKETING_REPORT_EMPTY", "The provider returned no report.");
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break;
    length += next.value.byteLength;
    if (length > 2_000_000) { await reader.cancel(); throw new ApiError(502, "MARKETING_REPORT_TOO_LARGE", "The provider report exceeded its safe size limit."); }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as T; }
  catch { throw new ApiError(502, "MARKETING_REPORT_INVALID", "The provider returned an unreadable report."); }
}
function safeLabel(value: unknown) { return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, "").slice(0, 500) : "Not specified"; }
function values(keys: string[], raw: unknown[]) { return Object.fromEntries(keys.map((key, i) => [key, finiteMetric(raw[i])])); }

type GAResponse = {
  rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }>;
  rowCount?: number;
  metadata?: { timeZone?: string; subjectToThresholding?: boolean; dataLossFromOtherRow?: boolean; samplingMetadatas?: unknown[] };
};
const gaNames = ["sessions", "engagedSessions", "screenPageViews", "keyEvents"];
function gaValues(row?: NonNullable<GAResponse["rows"]>[number]) {
  const result = values(["sessions", "engagedSessions", "views", "keyEvents"], row?.metricValues?.map((v) => v.value) ?? []);
  return { ...result, engagementRate: metricRatio(result.engagedSessions, result.sessions, 100) };
}
async function gaReport(token: string, selection: SelectedMarketingResource, report: MarketingReport) {
  if (!/^properties\/\d+$/.test(selection.externalResourceRef)) throw new ApiError(409, "MARKETING_RESOURCE_INVALID", "Choose a valid Analytics property.");
  const root = `https://analyticsdata.googleapis.com/v1beta/${selection.externalResourceRef}`;
  if (report.view === "realtime") {
    const response = await providerReport<GAResponse>(`${root}:runRealtimeReport`, token, { metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }], returnPropertyQuota: true });
    report.columns = [column("activeUsers", "Active users · last 30 minutes"), column("views", "Views · last 30 minutes")];
    report.totals = values(["activeUsers", "views"], response.rows?.[0]?.metricValues?.map((v) => v.value) ?? []);
    report.previousPeriod = null;
    report.timeZone = "Rolling 30-minute window";
    report.limitations = ["GA4 realtime activity is a rolling estimate, not a count of people currently on the site. It depends on consent and correct tagging."];
    return;
  }
  const dimension = { daily: "date", channels: "sessionDefaultChannelGroup", pages: "pagePath", devices: "deviceCategory" }[report.view as "daily" | "channels" | "pages" | "devices"];
  const request = (period: Period, dimensions: string[]) => providerReport<GAResponse>(`${root}:runReport`, token, {
    dateRanges: [{ startDate: period.start, endDate: period.end }], dimensions: dimensions.map((name) => ({ name })),
    metrics: gaNames.map((name) => ({ name })), limit: String(LIMIT), returnPropertyQuota: true,
    ...(dimensions.length ? { orderBys: report.view === "daily" ? [{ dimension: { dimensionName: "date" } }] : [{ metric: { metricName: "sessions" }, desc: true }] } : {}),
  });
  const [detail, total, previous] = await Promise.all([request(report.period, [dimension]), request(report.period, []), request(report.previousPeriod!, [])]);
  report.columns = [column("sessions", "Sessions"), column("views", "Page views"), column("keyEvents", "Key events"), column("engagementRate", "Engagement rate", "percent")];
  report.rows = (detail.rows ?? []).slice(0, LIMIT).map((row) => {
    const label = safeLabel(row.dimensionValues?.[0]?.value);
    return { label: report.view === "daily" && /^\d{8}$/.test(label) ? `${label.slice(0,4)}-${label.slice(4,6)}-${label.slice(6)}` : label, values: gaValues(row) };
  });
  report.totals = gaValues(total.rows?.[0]); report.previous = gaValues(previous.rows?.[0]);
  report.timeZone = total.metadata?.timeZone || "GA4 property time zone";
  report.truncated = (detail.rowCount ?? 0) > LIMIT || (detail.rows?.length ?? 0) > LIMIT;
  if ([detail, total, previous].some((r) => r.metadata?.subjectToThresholding)) report.warnings.push("GA4 privacy thresholding can omit results.");
  if ([detail, total, previous].some((r) => r.metadata?.dataLossFromOtherRow)) report.warnings.push("GA4 grouped some dimension values into its Other row.");
  if ([detail, total, previous].some((r) => r.metadata?.samplingMetadatas?.length)) report.warnings.push("GA4 returned sampled data.");
  report.limitations = ["Totals are requested separately from dimension rows. Sessions across pages are not additive.", "Key events depend on the property's event configuration and are not automatically leads or sales.", "Recent GA4 reports can change as processing completes. Missing results remain unavailable."];
}

type SearchResponse = { rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number; position?: number }>; responseAggregationType?: string };
function searchValues(row?: NonNullable<SearchResponse["rows"]>[number]) {
  const clicks = finiteMetric(row?.clicks), impressions = finiteMetric(row?.impressions);
  return { clicks, impressions, ctr: metricRatio(clicks, impressions, 100), position: impressions !== null && impressions > 0 ? finiteMetric(row?.position) : null };
}
async function searchReport(token: string, selection: SelectedMarketingResource, report: MarketingReport) {
  if (!/^(sc-domain:|https?:\/\/)/.test(selection.externalResourceRef) || selection.externalResourceRef.length > 500) throw new ApiError(409, "MARKETING_RESOURCE_INVALID", "Choose a valid Search Console property.");
  const dimension = { daily: "date", queries: "query", pages: "page", devices: "device" }[report.view as "daily" | "queries" | "pages" | "devices"];
  const request = (period: Period, dimensions: string[]) => providerReport<SearchResponse>(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(selection.externalResourceRef)}/searchAnalytics/query`, token, {
    startDate: period.start, endDate: period.end, dimensions, type: "web", dataState: "final", aggregationType: "auto", rowLimit: LIMIT,
  });
  const [detail, total, previous] = await Promise.all([request(report.period, [dimension]), request(report.period, []), request(report.previousPeriod!, [])]);
  report.columns = [column("clicks", "Clicks"), column("impressions", "Impressions"), column("ctr", "Click-through rate", "percent"), column("position", "Average position", "position")];
  report.rows = (detail.rows ?? []).slice(0, LIMIT).map((row) => ({ label: safeLabel(row.keys?.[0]), values: searchValues(row) }));
  report.totals = searchValues(total.rows?.[0]); report.previous = searchValues(previous.rows?.[0]);
  report.timeZone = "America/Los_Angeles";
  report.truncated = (detail.rows?.length ?? 0) >= LIMIT;
  report.limitations = ["Search Console average position is not a fixed rank or a local map-grid ranking.", "Only finalized web-search data is requested, with a three-day reporting delay. Top rows and anonymized queries are limited by Google.", "Property totals are separate from page and query rows; those rows must not be added to recreate totals."];
}

async function businessReport(token: string, selection: SelectedMarketingResource, report: MarketingReport) {
  const location = /^accounts\/[\w-]+\/locations\/([\w-]+)$/.exec(selection.externalResourceRef)?.[1];
  if (!location) throw new ApiError(409, "MARKETING_RESOURCE_INVALID", "Choose a valid Business Profile location.");
  report.previousPeriod = null; report.timeZone = "Business Profile reporting dates";
  report.limitations = ["Google Business Profile content is fetched on demand, not stored by this reporting endpoint or sent to Vanteloq AI. Measures stay in their original source series.", "Calls are call-button clicks, not completed calls. Directions and website clicks are not confirmed visits or sales."];
  if (report.view === "keywords") {
    const month = new Date(`${report.fetchedAt.slice(0, 7)}-01T00:00:00Z`); month.setUTCMonth(month.getUTCMonth() - 1);
    const monthLabel = month.toISOString().slice(0, 7);
    report.period = { start: `${monthLabel}-01`, end: new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).toISOString().slice(0, 10) };
    const url = new URL(`https://businessprofileperformance.googleapis.com/v1/locations/${location}/searchkeywords/impressions/monthly`);
    for (const bound of ["startMonth", "endMonth"]) { url.searchParams.set(`monthlyRange.${bound}.year`, String(month.getUTCFullYear())); url.searchParams.set(`monthlyRange.${bound}.month`, String(month.getUTCMonth() + 1)); }
    url.searchParams.set("pageSize", "100");
    const response = await providerReport<{ searchKeywordsCounts?: Array<{ searchKeyword?: string; insightsValue?: { value?: string; threshold?: string } }>; nextPageToken?: string }>(url.toString(), token);
    report.columns = [column("impressions", "Google keyword count")];
    report.rows = (response.searchKeywordsCounts ?? []).slice(0, 100).map((row) => ({ label: safeLabel(row.searchKeyword), values: { impressions: finiteMetric(row.insightsValue?.value) }, ...(row.insightsValue?.threshold !== undefined ? { note: `Below Google's reporting threshold of ${safeLabel(row.insightsValue.threshold)}` } : {}) }));
    report.truncated = Boolean(response.nextPageToken);
    report.limitations.push("Search terms use the previous complete calendar month. Thresholded counts are not zeros. At most 100 provider-returned terms are shown.");
    return;
  }
  const metrics = ["BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", "BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_MAPS", "WEBSITE_CLICKS", "CALL_CLICKS", "BUSINESS_DIRECTION_REQUESTS"];
  const labels = ["Desktop Search", "Mobile Search", "Desktop Maps", "Mobile Maps", "Website clicks", "Call clicks", "Direction requests"];
  const url = new URL(`https://businessprofileperformance.googleapis.com/v1/locations/${location}:fetchMultiDailyMetricsTimeSeries`);
  metrics.forEach((metric) => url.searchParams.append("dailyMetrics", metric));
  for (const [bound, value] of [["startDate", report.period.start], ["endDate", report.period.end]]) {
    const [year, month, day] = value.split("-");
    url.searchParams.set(`dailyRange.${bound}.year`, year); url.searchParams.set(`dailyRange.${bound}.month`, String(Number(month))); url.searchParams.set(`dailyRange.${bound}.day`, String(Number(day)));
  }
  const response = await providerReport<{ multiDailyMetricTimeSeries?: Array<{ dailyMetricTimeSeries?: Array<{ dailyMetric?: string; timeSeries?: { datedValues?: Array<{ date?: { year: number; month: number; day: number }; value?: string }> } }> }> }>(url.toString(), token);
  const rows = new Map<string, ReportRow>();
  for (const series of (response.multiDailyMetricTimeSeries ?? []).flatMap((group) => group.dailyMetricTimeSeries ?? [])) {
    if (!series.dailyMetric || !metrics.includes(series.dailyMetric)) continue;
    for (const point of series.timeSeries?.datedValues ?? []) {
      if (!point.date) continue;
      const date = `${point.date.year}-${String(point.date.month).padStart(2,"0")}-${String(point.date.day).padStart(2,"0")}`;
      if (date < report.period.start || date > report.period.end) continue;
      const row = rows.get(date) ?? { label: date, values: {} }; row.values[series.dailyMetric] = finiteMetric(point.value); rows.set(date, row);
    }
  }
  report.columns = metrics.map((metric, i) => column(metric, labels[i]));
  report.rows = [...rows.values()].sort((a,b) => a.label.localeCompare(b.label));
}

async function metaReport(token: string, selection: SelectedMarketingResource, report: MarketingReport) {
  if (!/^act_\d+$/.test(selection.externalResourceRef)) throw new ApiError(409, "MARKETING_RESOURCE_INVALID", "Choose a valid Meta advertising account.");
  const version = getRuntimeEnv().META_GRAPH_API_VERSION?.trim() || "v25.0";
  if (!/^v\d{1,2}\.\d$/.test(version)) throw new ApiError(409, "META_VERSION_INVALID", "Meta reporting configuration needs attention.");
  const root = `https://graph.facebook.com/${version}/${selection.externalResourceRef}`;
  const account = await providerReport<{ currency?: string; timezone_name?: string }>(`${root}?fields=currency,timezone_name`, token);
  report.currency = /^[A-Z]{3}$/.test(account.currency ?? "") ? account.currency! : null;
  report.timeZone = account.timezone_name || "Meta ad-account time zone";
  type MetaResponse = { data?: Array<Record<string, unknown>>; paging?: { next?: string } };
  const request = (period: Period, detail: boolean) => {
    const url = new URL(`${root}/insights`);
    url.searchParams.set("fields", `date_start,impressions,reach,clicks,inline_link_clicks,spend${detail && report.view === "campaigns" ? ",campaign_name" : ""}`);
    url.searchParams.set("level", detail && report.view === "campaigns" ? "campaign" : "account");
    url.searchParams.set("time_range", JSON.stringify({ since: period.start, until: period.end }));
    url.searchParams.set("limit", String(LIMIT));
    if (detail && report.view === "daily") url.searchParams.set("time_increment", "1");
    if (detail && report.view === "platforms") url.searchParams.set("breakdowns", "publisher_platform");
    return providerReport<MetaResponse>(url.toString(), token);
  };
  const [detail, total, previous] = await Promise.all([request(report.period, true), request(report.period, false), request(report.previousPeriod!, false)]);
  const convert = (row?: Record<string, unknown>) => {
    const result = values(["impressions", "reach", "clicks", "linkClicks", "spend"], [row?.impressions, row?.reach, row?.clicks, row?.inline_link_clicks, row?.spend]);
    if (!report.currency) result.spend = null;
    return { ...result, linkCtr: metricRatio(result.linkClicks, result.impressions, 100), linkCpc: metricRatio(result.spend, result.linkClicks), cpm: metricRatio(result.spend, result.impressions, 1000) };
  };
  report.columns = [column("impressions", "Impressions"), column("reach", "Reach"), column("linkClicks", "Link clicks"), column("spend", "Spend", "currency"), column("linkCtr", "Link CTR", "percent"), column("linkCpc", "Cost per link click", "currency")];
  report.rows = (detail.data ?? []).slice(0, LIMIT).map((row) => ({ label: safeLabel(row[report.view === "campaigns" ? "campaign_name" : report.view === "platforms" ? "publisher_platform" : "date_start"]), values: convert(row) }));
  report.totals = convert(total.data?.[0]); report.previous = convert(previous.data?.[0]);
  report.truncated = Boolean(detail.paging?.next) || (detail.data?.length ?? 0) > LIMIT;
  report.limitations = ["Reach is the provider's unique-account estimate for each scope. Daily, campaign and platform reach must not be summed.", "This is paid advertising performance, not Facebook Page or Instagram organic insights. Organic reporting requires separate permissions and resource selection.", "Link CTR = link clicks ÷ impressions. Cost per link click = spend ÷ link clicks. These are not Meta's all-click CTR and CPC.", "Ad clicks and spend do not prove sales attribution or profitability."];
}

export async function fetchMarketingReport(token: string, selection: SelectedMarketingResource, view: ReportView, days: number, now = new Date()): Promise<MarketingReport> {
  if (!REPORT_VIEWS[selection.dataset]?.includes(view)) throw new ApiError(400, "MARKETING_REPORT_VIEW_INVALID", "Choose a report supported by this source.");
  if (![7,28,90].includes(days)) throw new ApiError(400, "MARKETING_REPORT_PERIOD_INVALID", "Choose a 7, 28 or 90 day report.");
  // Two UTC calendar days avoids including an unfinished day in western provider time zones.
  const report: MarketingReport = { dataset: selection.dataset, view, ...reportingWindow(days, now, selection.dataset === "google_search_console" ? 3 : 2), rows: [], totals: {}, previous: null, columns: [], currency: null, timeZone: "Provider reporting dates", fetchedAt: now.toISOString(), warnings: [], limitations: [], truncated: false };
  if (selection.dataset === "google_analytics") await gaReport(token, selection, report);
  else if (selection.dataset === "google_search_console") await searchReport(token, selection, report);
  else if (selection.dataset === "google_business_profile") await businessReport(token, selection, report);
  else if (selection.dataset === "meta_ads") await metaReport(token, selection, report);
  else await googleAdsReport(token, selection, report);
  if (view !== "realtime" && view !== "keywords") report.limitations.push(`The reporting window ends ${selection.dataset === "google_search_console" ? "three" : "two"} UTC calendar days before retrieval to allow for provider processing. It is not a live sales feed.`);
  if (report.truncated) report.warnings.push("This report shows a bounded set of provider rows. Totals may include rows not shown.");
  return report;
}

async function googleAdsReport(token: string, selection: SelectedMarketingResource, report: MarketingReport) {
  const env = getRuntimeEnv();
  if (!/^customers\/\d+$/.test(selection.externalResourceRef)) throw new ApiError(409, "MARKETING_RESOURCE_INVALID", "Choose a valid Google Ads account.");
  const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  if (!developerToken) throw new ApiError(409, "GOOGLE_ADS_SETUP_REQUIRED", "Google Ads reporting needs a configured, production-approved developer token.");
  const version = googleAdsVersion();
  const access = await resolveGoogleAdsAccount(token, selection.externalResourceRef);
  if (access.testAccount) report.limitations.push("Google Ads test account: these results are for verification only and do not represent live advertising performance.");
  const headers = googleAdsHeaders(token, access.loginCustomerId);
  type AdsRow = { customer?: { currencyCode?: string; timeZone?: string }; campaign?: { name?: string }; segments?: { date?: string }; metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number; conversionsValue?: number } };
  const query = async (period: Period, detail: boolean) => {
    const dimension = !detail ? "" : report.view === "campaigns" ? "campaign.name, " : "segments.date, ";
    const result = await providerReport<{ results?: AdsRow[]; nextPageToken?: string }>(`https://googleads.googleapis.com/${version}/${selection.externalResourceRef}/googleAds:search`, token, {
      query: `SELECT ${dimension}customer.currency_code, customer.time_zone, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM ${detail && report.view === "campaigns" ? "campaign" : "customer"} WHERE segments.date BETWEEN '${period.start}' AND '${period.end}'${detail ? ` ORDER BY ${report.view === "campaigns" ? "metrics.impressions DESC" : "segments.date"}` : ""} LIMIT ${LIMIT}`,
    }, headers);
    return result;
  };
  const [detail, total, previous] = await Promise.all([query(report.period, true), query(report.period, false), query(report.previousPeriod!, false)]);
  const account = total.results?.[0]?.customer ?? detail.results?.[0]?.customer;
  report.currency = /^[A-Z]{3}$/.test(account?.currencyCode ?? "") ? account!.currencyCode! : null;
  report.timeZone = account?.timeZone || "Google Ads account time zone";
  const convert = (row?: AdsRow) => {
    const data = row?.metrics;
    const spendMicros = finiteMetric(data?.costMicros), clicks = finiteMetric(data?.clicks), impressions = finiteMetric(data?.impressions);
    const spend = report.currency && spendMicros !== null ? spendMicros / 1_000_000 : null;
    return { impressions, clicks, spend, conversions: finiteMetric(data?.conversions), ctr: metricRatio(clicks, impressions, 100), cpc: metricRatio(spend, clicks) };
  };
  report.columns = [column("impressions", "Impressions"), column("clicks", "Clicks"), column("spend", "Spend", "currency"), column("conversions", "Attributed conversions"), column("ctr", "Click-through rate", "percent"), column("cpc", "Cost per click", "currency")];
  report.rows = (detail.results ?? []).slice(0, LIMIT).map((row) => ({ label: safeLabel(report.view === "campaigns" ? row.campaign?.name : row.segments?.date), values: convert(row) }));
  report.totals = convert(total.results?.[0]); report.previous = convert(previous.results?.[0]);
  report.truncated = Boolean(detail.nextPageToken) || (detail.results?.length ?? 0) >= LIMIT;
  report.limitations.push("Conversions use the Google Ads account's conversion configuration and attribution model. They are not independently verified customers or profit.", "Spend is converted from micros into the ad account's currency. Different account currencies are never combined.", "Production availability depends on Google's developer-token approval and the signed-in user's account access.");
}
