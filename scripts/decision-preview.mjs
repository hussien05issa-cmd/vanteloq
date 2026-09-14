// Loopback-only UI fixture. No credentials, production records or API mutations.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
const bundle = await build({ entryPoints: ["tests/fixtures/decision-preview.tsx"], bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", logLevel: "error" });
const css = (await Promise.all(["globals", "operating", "theme", "brand", "design-v2", "readability", "experience", "workspace-design", "typography", "decision-workspace"].map(name => readFile(`app/${name}.css`, "utf8")))).join("\n");
createServer((request, response) => {
  if (request.url === "/preview.js") { response.setHeader("Content-Type", "application/javascript"); response.end(bundle.outputFiles[0].text); return; }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vanteloq opportunity preview · fictional data</title><style>${css}body{margin:0}.operating-shell{display:grid;min-height:100vh}.fixture-sidebar{padding:28px 20px;background:#0d2037;color:white}.fixture-sidebar strong{display:block;font-size:22px}.fixture-sidebar small{display:block;color:#b7c9df;margin:16px 0 36px}.fixture-sidebar b{display:block;padding:12px;background:#203957;border-radius:8px}.fixture-sidebar p{padding:8px 12px}.fixture-notice{display:flex;justify-content:space-between;flex-wrap:wrap;gap:16px;padding:22px 32px;background:white;border-bottom:1px solid #dce4ee}.fixture-notice label{display:flex;gap:8px}@media(max-width:800px){.operating-shell{grid-template-columns:minmax(0,1fr)}.fixture-sidebar{display:none}.fixture-notice{padding:16px}}</style><div id="root"></div><script type="module" src="/preview.js"></script></html>`);
}).listen(5191, "127.0.0.1", () => console.log("Opportunity fixture: http://127.0.0.1:5191/"));
