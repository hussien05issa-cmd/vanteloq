// Loopback-only production component fixture. Never requests business records.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const root = fileURLToPath(new URL("../", import.meta.url));
const result = await build({ absWorkingDir: root, entryPoints: ["tests/fixtures/owner-briefing-review-preview.tsx"], bundle: true, write: false, outdir: "owner-briefing-review", format: "esm", platform: "browser", jsx: "automatic", external: ["/fonts/*"], define: { "process.env.NODE_ENV": '"development"' } });
const javascript = result.outputFiles.find(file => file.path.endsWith(".js"))?.text, css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text;
if (!javascript || !css) throw new Error("The review fixture needs the production component and styles.");
const font = await readFile(new URL("../public/fonts/geist-latin.woff2", import.meta.url));
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vanteloq briefing review · Fictional records</title><link rel="stylesheet" href="/preview.css"><style>*{box-sizing:border-box}body{margin:0;font-family:var(--font-product);background:#020203}.briefing-review-preview{display:block;max-width:1160px;min-height:100dvh;margin:auto;padding:28px}.briefing-review-preview>header>p:first-child{font-size:12px;font-weight:600;letter-spacing:.05em}.briefing-review-preview h1{font-size:28px}.briefing-review-preview>nav{display:flex;align-items:center;flex-wrap:wrap;gap:16px}.briefing-review-preview>nav button,.briefing-review-preview select{min-height:44px;padding:10px 12px;border:1px solid var(--ws-line);border-radius:10px;background:var(--ws-panel);color:var(--ws-ink);font:inherit}.briefing-review-preview>nav label{display:flex;align-items:center;gap:8px;font-size:14px}.fixture-notice{min-height:24px;font-size:14px}.browser-results{padding:30px;background:white;color:#14243b;font:16px Arial,sans-serif}.browser-results li{margin:16px 0}@media(max-width:767px){.briefing-review-preview{padding:16px}.briefing-review-preview h1{font-size:24px}}</style></head><body><div id="root"></div><script type="module" src="/preview.js"></script></body></html>`;
const server = createServer((request, response) => {
  const path = new URL(request.url || "/", "http://127.0.0.1:5223").pathname;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'");
  if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405); response.end(); return; }
  const asset = path === "/preview.js" ? [javascript, "text/javascript"] : path === "/preview.css" ? [css, "text/css"] : path === "/fonts/geist-latin.woff2" ? [font, "font/woff2"] : path === "/" ? [html, "text/html"] : null;
  if (!asset) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "Content-Type": asset[1] }); response.end(request.method === "HEAD" ? undefined : asset[0]);
});
server.listen(5223, "127.0.0.1", () => console.log("Fictional owner briefing review: http://127.0.0.1:5223/"));
