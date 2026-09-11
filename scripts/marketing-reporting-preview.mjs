// Local-only UI fixture. No production auth, provider API or customer data is used.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: ["tests/fixtures/marketing-preview.tsx"], bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic",
  plugins: [{ name: "fixture-api", setup(builder) {
    builder.onResolve({ filter: /^\.\/supabase-browser$/ }, () => ({ path: "fixture-api", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'export const apiFetch = (input, init) => { const url = new URL(input, location.origin); url.searchParams.set("fixtureState", new URLSearchParams(location.search).get("state") || "populated"); return fetch(url, init); };' }));
  }}], logLevel: "error",
});
const css = await readFile("app/marketing-reporting.css", "utf8");
const sources = [
  { id: "fixture-analytics", dataset: "google_analytics", name: "Example website", status: "ready" },
  { id: "fixture-search", dataset: "google_search_console", name: "Example search property", status: "ready" },
  { id: "fixture-meta", dataset: "meta_ads", name: "Example ad account", status: "ready" },
];
const columns = [{ key: "sessions", label: "Sessions", unit: "count" }, { key: "views", label: "Page views", unit: "count" }, { key: "keyEvents", label: "Key events", unit: "count" }, { key: "engagementRate", label: "Engagement rate", unit: "percent" }];
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:5182");
  const send = (status, body, type = "application/json") => { response.writeHead(status, { "content-type": type, "cache-control": "no-store" }); response.end(type === "application/json" ? JSON.stringify(body) : body); };
  if (url.pathname === "/preview.js") return send(200, bundle.outputFiles[0].text, "application/javascript");
  if (url.pathname === "/api/v1/marketing/reports") {
    const selectionId = url.searchParams.get("selectionId"), state = url.searchParams.get("fixtureState");
    if (state === "source-error" || state === "error" && selectionId) return send(429, { error: { message: "The provider is limiting reporting requests. Wait before refreshing." } });
    if (!selectionId) return send(200, { sources: state === "empty" ? [] : sources });
    const view = url.searchParams.get("view") ?? "daily";
    const rows = view === "daily" ? Array.from({ length: 28 }, (_, i) => ({ label: new Date(Date.UTC(2026, 7, 10 + i)).toISOString().slice(0, 10), values: { sessions: 120 + i * 8 + Math.round(Math.sin(i) * 48), views: 300 + i * 9, keyEvents: i % 7 === 0 ? null : 5 + i % 4, engagementRate: 62 + i % 8 } })) : ["Organic Search", "Direct", "Paid Social", "Referral"].map((label, i) => ({ label, values: { sessions: 2450 - i * 520, views: 6800 - i * 1050, keyEvents: 86 - i * 14, engagementRate: 64 - i * 11 } }));
    return send(200, { report: { dataset: sources.find((source) => source.id === selectionId)?.dataset, view, period: { start: "2026-08-10", end: "2026-09-06" }, previousPeriod: view === "realtime" ? null : { start: "2026-07-13", end: "2026-08-09" }, columns, rows, totals: { sessions: 6280, views: 14280, keyEvents: 218.5, engagementRate: 65.3 }, previous: { sessions: 5740, views: 13090, keyEvents: 192, engagementRate: 62.1 }, currency: null, timeZone: "America/Edmonton", fetchedAt: "2026-09-08T06:00:00Z", warnings: [], limitations: ["Illustrative fixture values only. Not real customer measurements.", "Missing values remain unavailable. Source totals are independent of dimension rows."], truncated: false } });
  }
  if (url.pathname !== "/") return send(404, { error: "Not found" });
  return send(200, '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Vanteloq marketing report verification</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f6fa;font-family:Inter,Arial,sans-serif}.preview-nav{display:flex;flex-wrap:wrap;gap:18px;padding:18px 24px;background:#0e243d;color:#fff;font-size:12px}.preview-nav a{color:#c8e1ff}main{max-width:1240px;margin:auto;padding:30px 24px}@media(max-width:540px){main{padding:20px 14px}}' + css + '</style></head><body><div id="root"></div><script type="module" src="/preview.js"></script></body></html>', "text/html");
});
server.listen(5182, "127.0.0.1", () => console.log("Local marketing UI fixture: http://127.0.0.1:5182"));
