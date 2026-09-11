// Loopback-only fixture. Writes stay in memory and never touch real accounts or providers.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { build } from "esbuild";
const bundle = await build({ entryPoints: ["tests/fixtures/marketing-workbench-preview.tsx"], bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", define: { "process.env.NEXT_PUBLIC_LOCAL_MAP_STYLE_URL": '""' }, plugins: [{ name: "fixture-api", setup(builder) {
  builder.onResolve({ filter: /^\.\/supabase-browser$/ }, () => ({ path: "fixture-api", namespace: "fixture" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'export const apiFetch = (input, init) => { const url = new URL(input, location.origin); url.searchParams.set("fixtureState", new URLSearchParams(location.search).get("state") || "populated"); return fetch(url, init); };' }));
} }], logLevel: "error" });
const styles = ["globals", "operating", "theme", "brand", "design-v2", "readability", "experience", "workspace-design", "marketing-reporting", "marketing-workbench"];
const css = (await Promise.all(styles.map((name) => readFile(`app/${name}.css`, "utf8")))).join("\n");
const calendars = new Map(), failures = new Set();
const publicRoot = resolve("public");
const coverage = { status: "missing", freshness: "No verified records", evidence: [], missingInputs: ["Approved records"] };
const profile = { saved: true, businessModel: "Independent retailer", primaryOffer: "Product education", targetAudience: "New customers", serviceArea: "Edmonton", primaryGoal: "sales", websiteUrl: "https://example.com/shop", googleProfileStatus: "not_set", notes: "" };
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:5185"), state = url.searchParams.get("fixtureState") || "populated";
  const send = (status, body, type = "application/json") => { response.writeHead(status, { "content-type": type, "cache-control": "no-store" }); response.end(type === "application/json" ? JSON.stringify(body) : body); };
  if (url.pathname === "/preview.js") return send(200, bundle.outputFiles[0].text, "application/javascript");
  if (url.pathname === "/api/v1/growth") {
    if (request.method === "POST") {
      if (state === "readonly") return send(403, { error: { message: "Owner or admin permission required." } });
      let raw = ""; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      if (state === "save-error" && !failures.has(state)) { failures.add(state); return send(503, { error: { message: "Fixture save failed. Your draft should remain intact. Retry once." } }); }
      const entries = calendars.get(state) ?? [];
      if (body.type === "marketing_calendar") entries.push({ ...body, id: crypto.randomUUID(), status: "planned" });
      if (body.type === "marketing_calendar_status") { const entry = entries.find((item) => item.id === body.id); if (entry) entry.status = body.status; }
      calendars.set(state, entries); return send(201, { saved: true });
    }
    const empty = state === "empty";
    return send(200, { growth: { status: empty ? "unavailable" : "available", reason: "No recorded touchpoints yet.", channels: empty ? [] : [{ source: "Google", leads: 8, customers: 3, transactions: 4, revenueCents: 68000, grossProfitCents: 26000 }], insight: null }, profile: { ...profile, saved: !empty }, organization: { businessName: "Example retailer" }, recommendations: [{ id: "fixture", title: "Review the product landing page", category: "conversion", priority: "high", rationale: "Review the relationship between campaign intent and the offer shown on the page.", action: "Check the product page and record one measurable improvement.", metrics: ["Qualified enquiries"], evidenceNeeded: ["Approved source report"], sourceLabel: "Google Analytics", sourceUrl: "https://support.google.com/analytics/answer/10917952", confidence: "low", confidenceReason: "Fixture evidence only", evidence: ["Illustrative example"], missingInputs: ["Actual customer measurements"], actionOwner: "Owner", actionDueDate: "Choose during review", reviewMethod: "Compare like-for-like periods", sourceFreshness: "Fixture", operatingCoverage: [] }], operatingCoverage: { customers: coverage, inventory: coverage, margin: coverage, cashReadiness: coverage, location: coverage }, marketingEvidence: coverage, calendar: calendars.get(state) ?? [], searchSeries: empty ? [] : [{ query: "retail products", observedDate: "2026-08-01", position: 12, sourceSystem: "owner_entry" }, { query: "coffee", observedDate: "2026-08-03", position: 2, sourceSystem: "owner_entry" }, { query: "retail products", observedDate: "2026-08-08", position: 8, sourceSystem: "owner_entry" }], measurementSeries: [], googleResourceReadiness: { status: "selection_required", missing: [], boundary: "Fixture" }, profileChecklist: { completedCount: 0, actionRequiredCount: 0, items: [], disclaimer: "Owner records only" }, localOpportunityModel: { status: "coordinates_required", centre: null, source: { name: "OpenStreetMap", attributionUrl: "https://www.openstreetmap.org/copyright", live: false }, candidates: [], boundary: "No live location data in this fixture" }, importCounts: { touchpoints: empty ? 0 : 36, transactions: empty ? 0 : 6, searchObservations: empty ? 0 : 3 }, connections: [], googleBusinessProfiles: [], metaAdAccounts: [], canManage: state !== "readonly", journeyCoverage: state === "readonly" ? null : { journeys: empty ? 0 : 18, stages: { discovery: empty ? 0 : 18, website: empty ? 0 : 12, contact: empty ? 0 : 8, customer: empty ? 0 : 3, purchase: empty ? 0 : 3 }, matchedTransactions: empty ? 0 : 4, unmatchedTransactions: empty ? 0 : 2, revenueAvailable: true, limited: false }, period: { since: "2026-08-01", through: "2026-09-08" }, sourceBoundary: "Illustrative local fixture only. No customer data.", scopeBoundary: "Organization fixture.", locationScope: null });
  }
  if (url.pathname === "/api/v1/marketing/reports") {
    if (!url.searchParams.has("selectionId")) return send(200, { sources: [{ id: "fixture-ga4", dataset: "google_analytics", name: "Example site", status: "ready", lastSyncAt: null }] });
    return send(200, { report: { dataset: "google_analytics", view: url.searchParams.get("view") ?? "daily", period: { start: "2026-08-01", end: "2026-08-28" }, previousPeriod: null, columns: [{ key: "sessions", label: "Sessions", unit: "count" }, { key: "engagementRate", label: "Engagement rate", unit: "percent" }], rows: [{ label: url.searchParams.get("view") === "channels" ? "Paid Social" : "2026-08-10", values: { sessions: 200, engagementRate: 30 } }], totals: { sessions: 200, engagementRate: 30 }, previous: null, currency: null, timeZone: "UTC", fetchedAt: "2026-09-08T08:00:00Z", warnings: [], limitations: ["Illustrative fixture. Not customer data."], truncated: false } });
  }
  if (url.pathname !== "/") {
    const target = resolve(publicRoot, `.${url.pathname}`);
    if (!target.startsWith(`${publicRoot}/`)) return send(404, {});
    try { const content = await readFile(target); return send(200, content, { ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" }[extname(target)] ?? "application/octet-stream"); } catch { return send(404, {}); }
  }
  return send(200, '<!doctype html><html lang="en"><head><meta charset=\"utf-8\"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Marketing workbench verification</title><style>' + css + '.preview-nav{display:flex;flex-wrap:wrap;gap:18px;padding:16px 24px;background:#0e243d;color:#fff;font-size:12px}.preview-nav a{color:#c8e1ff}.preview-main{max-width:1280px;margin:0 auto!important;min-height:100vh;width:100%!important}.preview-header{padding:20px 30px;background:#fff;border-bottom:1px solid #d4dfed}.preview-header span{font-size:11px;color:#60758e;font-weight:700;letter-spacing:.12em}.preview-header h1{font-size:28px;color:#142c48;margin:8px 0}.preview-main .content{padding:26px}.preview-main .growth-page{width:100%;margin:0}@media(max-width:600px){.preview-main .content{padding:16px}} </style></head><body><div id="root"></div><script type="module" src="/preview.js"></script></body></html>', "text/html");
});
server.listen(5185, "127.0.0.1", () => console.log("Marketing workbench local fixture: http://127.0.0.1:5185"));
