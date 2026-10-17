// Local component review with explicitly fictional businesses. No API requests.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url)).replace(/^\\\\\?\\/, "");
const source = `
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BusinessWorkspaceChoices, OwnerWorkspaceContext } from "./app/business-workspace-selector";
import LocationSetupDialog from "./app/location-setup-dialog";
import { IndustryConfigurationFields } from "./app/industry-configuration";
import { defaultIndustryConfiguration } from "./domain/industry-templates";
import "./app/governance.css";
import "./app/interface-polish.css";
import "./app/owner-pathways.css";
const workspaces = [{ id: "retail", name: "Example Retail", industry: "Retail", role: "owner", setupComplete: true }, { id: "cafe", name: "Example Café", industry: "Café", role: "owner", setupComplete: true }, { id: "restaurant", name: "Example Restaurant", industry: "Restaurant", role: "admin", setupComplete: true }, { id: "dealer", name: "Example Dealership", industry: "Car dealership", role: "manager", setupComplete: true }];
function Preview() {
  const [selected, setSelected] = useState("retail"), [configuration, setConfiguration] = useState(defaultIndustryConfiguration("retail"));
  const [dialog, setDialog] = useState(false), [failure, setFailure] = useState(false), [notice, setNotice] = useState("Fictional component preview. No business records or server requests.");
  const current = workspaces.find(item => item.id === selected);
  return <main className="owner-preview operating-shell"><header><p>LOCAL COMPONENT REVIEW · FICTIONAL DATA</p><h1>Owner pathways</h1><p>Actual selector, scope labels, business configuration and location setup components.</p></header><div className="owner-preview-grid"><aside className="owner-preview-sidebar"><BusinessWorkspaceChoices listing={{ workspaces, currentWorkspaceId: selected }} selectedWorkspaceId={selected} onSwitch={id => { setSelected(id); setConfiguration(defaultIndustryConfiguration(id === "dealer" ? "dealership" : id)); setNotice("Fictional selection changed. In the app this reloads the authorized business and all workspace state."); }}/></aside><section className="owner-preview-content"><OwnerWorkspaceContext businessName={current.name} industry={current.industry} locationName={selected === "retail" ? "Downtown" : null} limitedScope={selected === "dealer"}/><p role="status">{notice}</p><label className="owner-preview-test"><input type="checkbox" checked={failure} onChange={event => setFailure(event.target.checked)}/> Simulate a failed location save</label><button type="button" className="primary" onClick={() => setDialog(true)}>Add location</button><IndustryConfigurationFields value={configuration} onChange={setConfiguration}/></section></div>{dialog && <LocationSetupDialog close={() => setDialog(false)} create={async () => { await new Promise(resolve => setTimeout(resolve, 1300)); if (failure) throw new Error("The location could not be saved. Your entries are preserved. Try again."); setDialog(false); setNotice("Fictional location creation confirmed. No API request was sent."); }}/>}</main>;
}
createRoot(document.getElementById("root")).render(<Preview/>);
`;
const result = await build({ absWorkingDir: root, stdin: { contents: source, resolveDir: root, loader: "tsx", sourcefile: "owner-pathways-fixture.tsx" }, bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", outdir: "owner-pathways-fixture", logLevel: "error", define: { "process.env.NODE_ENV": '"development"' } });
const javascript = result.outputFiles.find(file => file.path.endsWith(".js"))?.text;
const css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text;
if (!javascript || !css) throw new Error("Owner preview requires the real components and styles.");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Owner pathways · Fictional preview</title><link rel="stylesheet" href="/preview.css"><style>body{margin:0;background:#edf3fb;color:#173453;font:16px system-ui,sans-serif}*{box-sizing:border-box}.owner-preview{display:block;max-width:1120px;margin:auto;padding:28px}.owner-preview>header>p:first-child{font-size:12px;letter-spacing:.07em;font-weight:700}.owner-preview header p{line-height:1.5}.owner-preview-grid{display:grid;grid-template-columns:280px minmax(0,1fr);gap:24px}.owner-preview-sidebar{background:linear-gradient(140deg,#182d49,#343251);border-radius:18px;padding:20px;color:#f1f6ff;align-self:start}.owner-preview-content{min-width:0;background:#fff;border:1px solid #c3d6ee;border-radius:18px;padding:24px}.owner-preview button.primary{min-height:48px;border:1px solid #1765c6;border-radius:12px;background:#1765c6;color:white;padding:12px 20px;cursor:pointer;font:inherit}.owner-preview-test{display:flex;gap:8px;align-items:center;margin:20px 0;font-size:14px}.owner-preview .modal-backdrop{position:fixed;inset:0;background:#0a183b99;z-index:50;display:flex;align-items:center;justify-content:center;padding:12px;backdrop-filter:blur(4px)}.owner-preview .location-owner-modal{max-height:calc(100dvh - 24px);overflow:auto;background:#f8fbff;width:min(100%,620px);border:1px solid #b9cce7;border-radius:20px;padding:24px;box-shadow:0 20px 60px #08163266;color:#183551}.owner-preview .location-owner-modal>header{display:flex;justify-content:space-between;align-items:start;gap:16px}.owner-preview .location-owner-modal>header button{font:inherit;color:#173b67;background:#eef4ff;border:1px solid #aebfd7;border-radius:10px;cursor:pointer}.owner-preview .location-owner-modal .wizard-grid{margin:20px 0}.owner-preview .location-owner-modal footer{display:flex;gap:12px;justify-content:flex-end}.owner-preview .location-owner-modal footer button{font:inherit;border:1px solid #aac0db;border-radius:10px;background:#fff;color:#244468;padding:10px 18px;cursor:pointer}.owner-preview .location-owner-modal footer .primary{background:#1765c6;color:#fff}.owner-preview .location-owner-modal button:disabled{opacity:.6;cursor:default}@media(max-width:700px){.owner-preview{padding:16px}.owner-preview-grid{grid-template-columns:1fr}.owner-preview-content{padding:18px}.owner-preview .location-owner-modal{padding:18px}.owner-preview h1{font-size:27px}}@media(prefers-reduced-motion:reduce){.owner-preview *{animation:none!important;transition:none!important}}</style></head><body><div id="root"></div><script type="module" src="/preview.js"></script></body></html>`;
createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
  if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405); response.end(); return; }
  const path = new URL(request.url || "/", "http://127.0.0.1:5214").pathname;
  const asset = path === "/preview.js" ? [javascript, "text/javascript"] : path === "/preview.css" ? [css, "text/css"] : path === "/" ? [html, "text/html"] : null;
  if (!asset) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "Content-Type": asset[1] + "; charset=utf-8" });
  response.end(request.method === "HEAD" ? undefined : asset[0]);
}).listen(5214, "127.0.0.1", () => console.log("Fictional owner pathways: http://127.0.0.1:5214/"));
