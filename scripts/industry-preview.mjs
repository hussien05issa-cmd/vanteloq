// Loopback-only real-component preview backed by an isolated built Worker and test D1.
// Run after the normal app build:
// node --experimental-transform-types --import ./scripts/test-loader.mjs scripts/industry-preview.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { createEnvironment, createReportWorkspace, dispatch } from "../tests/helpers/retail-worker-fixture.mjs";
import { defaultIndustryConfiguration } from "../domain/industry-templates.ts";

const port = Number(process.env.INDUSTRY_PREVIEW_PORT || 5192);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("Use a valid nonprivileged preview port.");
const localOrigin = `http://127.0.0.1:${port}`;
const allowedPaths = new Set(["/api/v1/foodservice", "/api/v1/dealership", "/api/v1/industry-configuration", "/api/v1/inventory-workflows", "/api/v1/sector-operations", "/api/v1/business-workflows", "/api/v1/workflow-followup"]);
  const bundle = await build({ absWorkingDir: process.cwd(), entryPoints: [resolve("tests/fixtures/industry-preview.tsx")], outdir: resolve("output/industry-preview-bundle"), tsconfigRaw: { compilerOptions: { jsx: "react-jsx", target: "es2022" } }, bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", logLevel: "error", plugins: [{ name: "local-api-only", setup(build) { build.onResolve({ filter: /\/supabase-browser$/ }, () => ({ path: resolve("tests/fixtures/industry-preview-api.ts") })); } }] });
  const javascript = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
  const componentCss = bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text || "";
const fixture = await createEnvironment();
const { worker, environment, database } = fixture;
async function checked(response, expected = 200) {
  const body = await response.json();
  if (response.status !== expected) throw Error(`Fixture setup failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}
async function createBusiness(template) {
  const account = await createReportWorkspace(worker, environment, database, `preview-${template}`);
  const current = await checked(await dispatch(worker, environment, "/api/v1/industry-configuration", account.owner));
  const configuration = defaultIndustryConfiguration(template);
  const preview = await checked(await dispatch(worker, environment, "/api/v1/industry-configuration", { ...account.owner, method: "POST", body: { action: "preview", configuration, expectedRevision: current.revision } }));
  await checked(await dispatch(worker, environment, "/api/v1/industry-configuration", { ...account.owner, method: "POST", body: { action: "save", configuration, expectedRevision: current.revision, fingerprint: preview.fingerprint } }));
  return account;
}
let server;
try {
  const accounts = { cafe: await createBusiness("cafe"), dealership: await createBusiness("dealership"), retail: await createBusiness("retail"), services: await createBusiness("services"), hospitality: await createBusiness("hospitality") };
  const money = minor => ({ currency: "CAD", minor });
  const recipe = { kind: "recipe", name: "Fictional soup batch", source: "Synthetic supplier invoice and yield sheet", asOfDate: "2026-09-30", payload: { currency: "CAD", portions: "10", ingredients: [{ id: "Vegetables", purchaseQuantity: { amount: "2", unit: "kg" }, purchaseCost: money(800), recipeQuantity: { amount: "1", unit: "kg" }, preparationYield: "0.8" }, { id: "Stock", purchaseQuantity: { amount: "1", unit: "l" }, purchaseCost: money(200), recipeQuantity: { amount: "500", unit: "ml" }, preparationYield: "1" }] } };
  const period = { kind: "period", name: "Fictional September food review", source: "Synthetic counts, sales and payroll summary", asOfDate: "2026-09-30", from: "2026-09-01", to: "2026-09-30", payload: { currency: "CAD", opening: money(100000), purchases: money(400000), supplierCredits: money(10000), transfersIn: money(20000), transfersOut: money(30000), closing: money(180000), foodNetSales: money(1000000), totalNetSales: money(1200000), theoreticalCost: money(275000), recordedWasteCost: money(10000), labourCost: money(400000), otherVariableCosts: money(50000), closedChecks: 600 } };
  for (const record of [recipe, period]) await checked(await dispatch(worker, environment, "/api/v1/foodservice", { ...accounts.cafe.owner, method: "POST", body: { action: "save", locationId: accounts.cafe.locationId, expectedVersion: null, reviewed: true, record } }), 201);
  await checked(await dispatch(worker, environment, "/api/v1/dealership", { ...accounts.dealership.owner, method: "POST", idempotencyKey: crypto.randomUUID(), body: { action: "acquire", mutationKey: crypto.randomUUID(), locationId: accounts.dealership.locationId, vehicle: { identifierKind: "legacy", identifier: "FICTIONAL-PREVIEW-001", year: 1980, make: "Sample", model: "Sedan", stockNumber: "DEMO-001", acquiredDate: "2026-09-10" }, ownership: "owned", physicalStatus: "on_lot", prepStatus: "in_progress", availability: "available", askingCents: 2490000 } }));
  const dealerState=await checked(await dispatch(worker,environment,"/api/v1/dealership",accounts.dealership.owner));
  await checked(await dispatch(worker,environment,"/api/v1/dealership",{...accounts.dealership.owner,method:"POST",body:{action:"save_task",mutationKey:crypto.randomUUID(),episodeId:dealerState.stock[0].id,title:"Review inspection before marking preparation ready",status:"blocked",assigneeId:null,dueDate:"2026-09-30",blockedReason:"Fictional example: waiting for the inspection report."}}));
  const baseCss = (await Promise.all(["globals", "operating", "theme", "brand", "design-v2", "readability", "experience", "workspace-design", "typography", "interface-polish", "reference-theme"].map(name => readFile(`app/${name}.css`, "utf8")))).join("\n");
  const css = `${baseCss}\n${componentCss}\nbody{margin:0;background:#f2f5f9;color:#15283e}.fixture-header{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:24px 32px;background:white;border-bottom:1px solid #dce4ee}.fixture-header strong{font-size:22px}.fixture-header p{margin:6px 0;color:#526275;max-width:75ch}.fixture-header label{display:grid;gap:8px;min-width:190px}.fixture-header select{min-height:44px;padding:8px;border:1px solid #b7c6d8;border-radius:8px}.fixture-nav{display:flex;flex-wrap:wrap;gap:8px;padding:16px 32px}.fixture-nav button{min-height:44px;padding:8px 14px;border:1px solid #c6d1df;border-radius:9px;background:white;color:#183a60;font:inherit}.fixture-nav button[aria-current=page]{background:#173b66;color:white}.fixture-main{max-width:1440px;margin:0 auto;padding:8px 32px 48px}.fixture-main>.industry-fit{margin:0}.fixture-header :focus-visible,.fixture-nav :focus-visible{outline:3px solid #356edf;outline-offset:3px}@media(max-width:700px){.fixture-header{padding:18px;align-items:stretch;flex-direction:column;gap:12px}.fixture-nav{padding:12px 18px;gap:7px}.fixture-main{padding:6px 12px 32px}}`;
  server = createServer(async (request, response) => {
    try {
      if (request.headers.host !== `127.0.0.1:${port}`) { response.writeHead(403).end(); return; }
      const url = new URL(request.url, localOrigin);
      response.setHeader("Cache-Control", "no-store"); response.setHeader("X-Content-Type-Options", "nosniff");
      if (url.pathname === "/responsive") { const width=Math.max(320,Math.min(1440,Number(url.searchParams.get("width"))||390)); response.writeHead(200,{"Content-Type":"text/html"});response.end(`<html><meta name="viewport" content="width=device-width"><title>Workflow responsive preview</title><body style="margin:0"><iframe title="Mobile workflow preview" src="/" style="width:${width}px;height:900px;border:0"></iframe></body></html>`);return; }
      if (url.pathname.startsWith("/api/")) {
        if (!allowedPaths.has(url.pathname) || !["GET", "POST"].includes(request.method)) { response.writeHead(404).end(); return; }
        if (request.method === "POST" && request.headers.origin !== localOrigin) { response.writeHead(403).end(); return; }
        const account = accounts[request.headers["x-preview-workspace"]];
        if (!account) { response.writeHead(400).end(); return; }
        let raw = ""; for await (const chunk of request) { raw += chunk; if (Buffer.byteLength(raw) > 120000) { response.writeHead(413).end(); return; } }
        const result = await dispatch(worker, environment, url.pathname + url.search, { ...account.owner, method: request.method, body: raw ? JSON.parse(raw) : undefined, idempotencyKey: request.headers["idempotency-key"] });
        response.writeHead(result.status, { "Content-Type": result.headers.get("content-type") || "application/json" }); response.end(Buffer.from(await result.arrayBuffer())); return;
      }
      if (url.pathname === "/preview.js") { response.writeHead(200, { "Content-Type": "application/javascript" }); response.end(javascript); return; }
      if (url.pathname === "/brand/vanteloq-mark-ui.webp") { response.writeHead(200, { "Content-Type": "image/webp" }); response.end(await readFile("public/brand/vanteloq-mark-ui.webp")); return; }
      if (url.pathname !== "/") { response.writeHead(404).end(); return; }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'" });
      response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vanteloq industry preview · fictional records</title><style>${css}</style><div id="root"></div><script type="module" src="/preview.js"></script></html>`);
    } catch (error) { response.writeHead(500, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : "Fixture request failed." } })); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  console.log(`Industry fixture ready: ${localOrigin}/ (fictional data, isolated D1; closes on Ctrl+C)`);
  let closing = false;
  async function close() { if (closing) return; closing = true; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fixture.dispose(); }
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void close().then(() => process.exit(0)); });
} catch (error) { if (server) server.close(); await fixture.dispose(); throw error; }
