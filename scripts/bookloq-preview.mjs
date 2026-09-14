// Loopback-only visual verification of the real BookLoQ component. All records
// come from an isolated test database; write operations are deliberately rejected.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { build } from "esbuild";
const bundle = await build({ stdin: { contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import BookLoQWorkspace from './app/bookloq-workspace'; import ProductBrandLogo from './app/product-brand-logo'; import WorkspaceIcon from './app/workspace-icon';
  const announce=()=>alert('Local demonstration only. No customer data or external action.');
  createRoot(document.getElementById('root')).render(<div className="app-shell operating-shell"><aside className="sidebar"><button className="brand"><ProductBrandLogo product="vanteloq"/><span className="brand-name">Vanteloq</span></button><div className="nav-group"><p>Sample Workspace</p>{['Dashboard','Sales','Inventory','BookLoQ','Integrations','Advisor'].map(name=><button key={name} className="nav-item" aria-current={name==='BookLoQ'?'page':undefined} onClick={announce}><WorkspaceIcon name={name}/><span className="nav-label">{name}</span></button>)}</div></aside><div className="main-panel"><div className="fixture-label">Local QA · Fictional records · No external actions</div><BookLoQWorkspace initialSection={new URLSearchParams(location.search).get('section')==='cash'?'Cash Flow':'Overview'} activeLocationId={null} createTask={announce} navigate={announce} showNotice={announce}/></div></div>);
`, resolveDir: process.cwd(), loader: "tsx" }, plugins: [{ name: "local-data", setup(builder) {
  builder.onLoad({ filter: /app[\\/]supabase-browser\.ts$/ }, () => ({ contents: 'export const apiFetch = (...args) => fetch(...args);', loader: 'ts' }));
} }], define: { "process.env": "{}" }, bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", logLevel: "error" });
const styles = [...(await readFile("app/layout.tsx", "utf8")).matchAll(/import "\.\/([^"\n]+\.css)"/g)].map(match => match[1]);
const sample = JSON.parse(await readFile("tests/fixtures/bookloq-preview.json", "utf8"));
// The forecast example is isolated from the ledger fixture and clearly labelled.
const scenario = await build({ stdin: { contents: 'export {bookloqDemo} from "./domain/bookloq-demo";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "esm", platform: "node" });
const { bookloqDemo } = await import(`data:text/javascript;base64,${Buffer.from(scenario.outputFiles[0].text).toString("base64")}`);
sample.bookloq.thirteenWeekCashFlow = bookloqDemo(600000, false, false);
createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path.startsWith("/api/")) {
      response.setHeader("Content-Type", "application/json");
      if (request.method !== "GET") { response.statusCode = 405; response.end(JSON.stringify({ error: { message: "Local preview is read only." } })); return; }
      response.end(JSON.stringify(path === "/api/v1/bookloq" ? sample : { integrations: [], canManageBankConnections: false })); return;
    }
    if (path === "/preview.js") { response.setHeader("Content-Type", "application/javascript"); response.end(bundle.outputFiles[0].text); return; }
    if (path.startsWith("/brand/") || path.startsWith("/fonts/")) {
      const root = resolve("public"), file = resolve(root, "." + path);
      if (!file.startsWith(root + sep)) throw new Error("Invalid path");
      response.setHeader("Content-Type", ({ ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".svg": "image/svg+xml" })[extname(file)] || "application/octet-stream");
      response.end(await readFile(file)); return;
    }
    const css = (await Promise.all(styles.map(file => readFile("app/" + file, "utf8")))).join("\n");
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BookLoQ · Local sample workspace</title><style>${css}\n.fixture-label{padding:12px 24px;color:#375777;background:#e7f0fa;font-size:13px}.main-panel{min-width:0}</style><div id="root"></div><script type="module" src="/preview.js"></script></html>`);
  } catch { response.statusCode = 404; response.end("Not found"); }
}).listen(5192, "127.0.0.1", () => console.log("BookLoQ preview: http://127.0.0.1:5192"));
