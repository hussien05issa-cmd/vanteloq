// Loopback-only visual fixture. No authentication, API calls or record mutations.
// Run from the project root: node scripts/food-review-preview.mjs
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = `
import { useState } from "react";
import { createRoot } from "react-dom/client";
import FoodOperationsOverview from "./app/food-operations-overview";
import { foodReviewToday } from "./domain/food-analytics";
import { validateSectorContent } from "./domain/sector-operations";
import "./app/sector-operations.css";
const location = { id: "fictional-cafe", name: "North café · Fictional location", currency: "CAD", timezone: "America/Denver" };
const date = foodReviewToday(location.timezone, new Date()) || "2026-10-04";
const recipes = [{ id: "croissant", label: "Butter croissants" }, { id: "sandwich", label: "Breakfast sandwiches" }];
function record(id, kind, title, values, batch = null, state = "completed") {
  const content = validateSectorContent({ kind, title, source: "Fictional QA source " + id, sourceDate: date, dueDate: "", currency: "CAD", notes: "Fictional record for local visual verification.", values, batch });
  return { ...content, id, locationId: location.id, version: 1, state, updatedAt: Date.now() };
}
function batch(id, recipeId, title, prepared, unusable, actualCost, state = "completed") {
  return record(id, "prep_batch", title, { recipeId, batchRef: id, portions: prepared * 1000, wastePortions: unusable * 1000, preparedDate: date, useByDate: date, ingredientSource: "Fictional ingredient count sheet", actualCost }, { output: { sku: recipeId.toUpperCase(), unit: "each", quantityMilli: (prepared - unusable) * 1000 }, inputs: [{ sku: "FICTIONAL-INGREDIENT", unit: "g", quantityMilli: prepared * 100000 }] }, state);
}
function service(id, daypart, sales, orders, late, minutes, cost) {
  return record(id, "service_period", daypart + " service", { serviceDate: date, daypart, projectedSales: sales + 10000, netSales: sales, plannedMinutes: minutes, paidMinutes: minutes, labourCost: cost, orders, lateOrders: late, coverageComplete: true });
}
function delivery(id, provider, sales, fees, foodCost, packaging, difference = 0) {
  const taxTips = Math.round(sales * 0.05);
  return record(id, "delivery_order", provider + " order " + id, { provider, orderRef: id, settlementRef: "Fictional payout " + id, netSales: sales, taxTips, fees, adjustments: 0, payout: sales + taxTips - fees - difference, foodCost, packaging, incrementalLabour: 0, resolved: false }, null, difference ? "reviewed" : "completed");
}
const records = [
  batch("B-101", "croissant", "Morning croissant batch", 30, 5, 6450),
  batch("B-102", "croissant", "Afternoon croissant batch", 18, 1, 3870),
  batch("B-103", "sandwich", "Breakfast sandwich batch", 24, 1, 7200),
  batch("DRAFT-104", "sandwich", "Unapproved prep draft", 12, 0, 3600, "draft"),
  service("S-201", "Breakfast", 180000, 60, 6, 720, 40000),
  service("S-202", "Lunch", 240000, 80, 4, 960, 50000),
  delivery("D-501", "Fictional delivery A", 12500, 2500, 3000, 500),
  delivery("D-502", "Fictional delivery A", 7500, 1200, 2200, 300),
  delivery("D-503", "Fictional delivery B", 10000, 2500, 3000, 500, 250)
];
function Fixture() {
  const query = new URLSearchParams(window.location.search).get("state");
  const [state, setState] = useState(["populated", "empty", "partial"].includes(query) ? query : "populated");
  const [selected, setSelected] = useState(null);
  return <main><header className="fixture-heading"><p>LOCAL PREVIEW · FICTIONAL DATA</p><h1>Food operations review</h1><p>Real review component and styles. Source selection changes only this preview's status.</p></header><nav className="fixture-nav" aria-label="Preview state">{["populated", "empty", "partial"].map(value => <button key={value} type="button" aria-pressed={state === value} onClick={() => { setState(value); setSelected(null); }}>{value === "populated" ? "Populated records" : value === "empty" ? "Empty records" : "Partial records"}</button>)}</nav><section className="fixture-source" role="status" aria-live="polite">{selected ? "Selected source: " + selected.title + " · " + selected.source + " · " + selected.sourceDate : "No source selected. Open Source batches, a service period or Source orders to inspect its source selection."}</section><div className="sector-operations"><FoodOperationsOverview key={state} records={state === "empty" ? [] : records} kinds={["prep_batch", "service_period", "delivery_order"]} partial={state === "partial"} location={location} recipes={recipes} onOpen={setSelected}/></div></main>;
}
createRoot(document.getElementById("root")).render(<Fixture/>);
`;

const result = await build({
  absWorkingDir: root,
  stdin: { contents: source, resolveDir: root, loader: "tsx", sourcefile: "food-review-fixture.tsx" },
  bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic",
  outdir: "food-review-fixture", logLevel: "error", define: { "process.env.NODE_ENV": '"development"' },
});
const javascript = result.outputFiles.find(file => file.path.endsWith(".js"))?.text;
const css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text;
if (!javascript || !css) throw new Error("The food review fixture did not produce its script and real styles.");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vanteloq food review · Fictional preview</title><link rel="stylesheet" href="/preview.css"><style>body{margin:0;background:#edf4fb;color:#142b49;font:14px Arial,sans-serif}*{box-sizing:border-box}main{max-width:1360px;margin:auto;padding:24px}.fixture-heading h1{font-size:28px;letter-spacing:-.025em}.fixture-heading p{line-height:1.6}.fixture-heading>p:first-child{font-size:12px;font-weight:700;letter-spacing:.055em}.fixture-nav{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0}.fixture-nav button{min-height:46px;padding:10px 16px;background:white;border:1px solid #adc4df;border-radius:10px;color:#173d68;font:inherit;cursor:pointer}.fixture-nav button[aria-pressed=true]{background:#0969ef;color:white;border-color:#0969ef}.fixture-nav button:focus-visible{outline:3px solid #1476dc;outline-offset:3px}.fixture-source{margin:0 0 18px;padding:13px 16px;background:#e7f2ff;border:1px solid #bcd3ed;border-radius:10px;line-height:1.6;overflow-wrap:anywhere}@media(max-width:650px){main{padding:12px}.fixture-heading h1{font-size:24px}.fixture-nav button{flex:1 1 140px}}</style></head><body><div id="root"></div><script type="module" src="/preview.js"></script></body></html>`;

createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
  const pathname = new URL(request.url || "/", "http://127.0.0.1:5198").pathname;
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405); response.end(); return; }
  const asset = pathname === "/preview.js" ? [javascript, "text/javascript"] : pathname === "/preview.css" ? [css, "text/css"] : pathname === "/" ? [html, "text/html"] : null;
  if (!asset) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "Content-Type": asset[1] + "; charset=utf-8" });
  response.end(request.method === "HEAD" ? undefined : asset[0]);
}).listen(5198, "127.0.0.1", () => console.log("Food review fixture: http://127.0.0.1:5198/ (fictional data only)"));
