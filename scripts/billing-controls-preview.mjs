// Isolated fictional preview. No authentication, API calls or billing changes.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = `
import { useState } from "react";
import { createRoot } from "react-dom/client";
import BillingSubscriptionControls, { BillingStatusRecovery } from "./app/billing-subscription-controls";
import "./app/billing.css";
const modes = ["active", "trialing", "scheduled", "past_due", "initial-error", "stale-status"];
function Fixture() {
  const query = new URLSearchParams(window.location.search).get("state");
  const [mode, setMode] = useState(modes.includes(query) ? query : "active");
  const [notice, setNotice] = useState("Preview only. No billing request is sent.");
  const [busy, setBusy] = useState(false);
  function action(name) { setNotice(name + " selected. This fictional preview sends no billing request."); }
  const current = { plan: "growth", status: mode === "scheduled" || mode === "stale-status" ? "active" : mode, addons: ["bookloq"], cancelAtPeriodEnd: mode === "scheduled", trialEndsAt: "2026-10-11T18:00:00Z", currentPeriodEndsAt: "2026-11-04T18:00:00Z" };
  return <main><header><p>LOCAL PREVIEW · FICTIONAL DATA</p><h1>Billing &amp; subscription</h1><p>Actual subscription controls and styles. Resize for desktop or mobile review.</p></header><nav aria-label="Fictional billing state">{modes.map(state => <button key={state} type="button" aria-pressed={mode === state} onClick={() => { setMode(state); setNotice("Preview only. No billing request is sent."); }}>{state}</button>)}</nav><label className="preview-busy"><input type="checkbox" checked={busy} onChange={event => setBusy(event.target.checked)}/> Preview waiting state</label><p role="status" className="preview-notice">{notice}</p>{mode === "initial-error" ? <section><h2>Billing status unavailable</h2><BillingStatusRecovery message="Billing status took too long to load. Try again." busy={busy} onRetry={() => action("Try again")}/></section> : <>{mode === "stale-status" && <BillingStatusRecovery message="Billing status took too long to load. Try again." stale busy={busy} onRetry={() => action("Try again")}/>}<BillingSubscriptionControls current={current} busy={busy} onManage={() => action("Manage billing")} onCancel={() => action("Cancel subscription")} onRefresh={() => action("Refresh status")}/></>}</main>;
}
createRoot(document.getElementById("root")).render(<Fixture/>);
`;
const result = await build({ absWorkingDir: root, stdin: { contents: source, resolveDir: root, loader: "tsx", sourcefile: "billing-controls-fixture.tsx" }, bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", outdir: "billing-controls-fixture", logLevel: "error", define: { "process.env.NODE_ENV": '"development"' } });
const javascript = result.outputFiles.find(file => file.path.endsWith(".js"))?.text;
const css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text;
if (!javascript || !css) throw new Error("Billing preview requires the real component and styles.");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Billing controls · Fictional preview</title><link rel="stylesheet" href="/preview.css"><style>body{margin:0;background:#edf3f9;color:#19344f;font:16px Arial,sans-serif}*{box-sizing:border-box}main{max-width:1080px;margin:auto;padding:28px}header p{line-height:1.6}header>p:first-child{font-size:12px;letter-spacing:.08em;font-weight:700}h1{font-size:30px}nav{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0}nav button{min-height:44px;border:1px solid #adc4df;border-radius:8px;background:white;padding:10px 14px;color:#173d68;font:inherit;cursor:pointer}nav button[aria-pressed=true]{background:#173d73;color:white}.preview-busy{display:flex;gap:8px;align-items:center}.preview-notice{border:1px solid #b8cee5;border-radius:9px;padding:14px;background:#e5f1fc;line-height:1.5}@media(max-width:600px){main{padding:14px}h1{font-size:25px}nav button{flex:1 1 140px}}</style></head><body><div id="root"></div><script type="module" src="/preview.js"></script></body></html>`;
createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
  if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405); response.end(); return; }
  const path = new URL(request.url || "/", "http://127.0.0.1:5202").pathname;
  const asset = path === "/preview.js" ? [javascript, "text/javascript"] : path === "/preview.css" ? [css, "text/css"] : path === "/" ? [html, "text/html"] : null;
  if (!asset) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "Content-Type": asset[1] + "; charset=utf-8" });
  response.end(request.method === "HEAD" ? undefined : asset[0]);
}).listen(5202, "127.0.0.1", () => console.log("Fictional billing controls: http://127.0.0.1:5202/"));
