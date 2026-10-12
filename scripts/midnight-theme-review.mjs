// Loopback-only production CSS fixture. No live data, AI or provider requests.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.PORT || 5236);
const result = await build({ absWorkingDir: root, entryPoints: ["tests/fixtures/midnight-theme-review.tsx"], bundle: true, write: false, outdir: "midnight-theme-review", format: "esm", platform: "browser", jsx: "automatic", conditions: ["style"], external: ["/fonts/*", "/images/*", "/brand/*"], define: { "process.env.NODE_ENV": '"development"' } });
const javascript = result.outputFiles.find(file => file.path.endsWith(".js"))?.text;
const stylesheet = result.outputFiles.find(file => file.path.endsWith(".css"))?.text;
if (!javascript || !stylesheet) throw new Error("Theme review requires the production controls and CSS.");
// Component sheets are repeated after the shared layer, reproducing lazy CSS
// arrival. Theme specificity must still keep data legible and surfaces opaque.
const lazyCss = await Promise.all(["decision-cards-panel", "business-workflows"].map(name => readFile(new URL(`../app/${name}.css`, import.meta.url), "utf8")));
const css = stylesheet + "\n" + lazyCss.join("\n") + `
.theme-review-preview .theme-fixture-brand{display:flex;align-items:center;gap:10px}
.theme-review-preview .theme-fixture-brand .product-brand-logo{flex:0 0 34px}
.theme-review-preview .theme-fixture-bookloq{display:flex;align-items:center;flex-wrap:wrap;gap:16px;margin-bottom:20px}
.theme-review-preview .theme-fixture-bookloq .product-brand-logo{width:190px;height:56px;max-width:100%}
.theme-review-preview .ai-studio-header{display:flex;align-items:center;gap:12px}
`;
const font = await readFile(new URL("../public/fonts/geist-latin.woff2", import.meta.url));
// Only explicitly named, local presentation assets are served. Request paths are
// never joined onto a filesystem path, so traversal cannot expose source files.
const brandAssets = new Map(await Promise.all(["vanteloq.jpg", "bookloq.jpg", "lexedge.jpg", "favicon.svg"].map(async name => [
  `/brand/origin-metal-2026/${name}`,
  [await readFile(new URL(`../public/brand/origin-metal-2026/${name}`, import.meta.url)), name.endsWith(".svg") ? "image/svg+xml" : "image/jpeg"],
])));
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vanteloq theme review · Fictional data</title><link rel="stylesheet" href="/review.css"><style>*{box-sizing:border-box}body{margin:0;background:#050608;font-family:var(--font-product)}.theme-review-preview.operating-shell{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:100dvh}.theme-review-preview .sidebar{position:static!important;inset:auto!important;display:flex!important;flex-direction:column;width:220px!important;height:auto!important;min-width:0;padding:24px 16px}.theme-review-preview .nav-group{width:100%}.theme-review-preview .nav-item{width:100%;text-align:left}.theme-fixture-brand{font-size:26px;font-weight:650;margin-bottom:28px}.theme-fixture-content{min-width:0;padding:24px;max-width:1280px}.theme-fixture-content>header{margin-bottom:24px}.theme-fixture-content>header h1{font-size:30px;line-height:1.2;margin:10px 0}.theme-fixture-content>header p{font-size:14px}.theme-fixture-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin:20px 0}.theme-fixture-tools{display:flex;flex-wrap:wrap;gap:12px}.theme-fixture-tools button{padding:10px 14px;border:1px solid var(--ws-control);border-radius:12px}.theme-fixture-content>.settings-form,.theme-fixture-content>.bq-collection-panel,.theme-fixture-content>.ai-studio{padding:24px;margin:22px 0;border:1px solid var(--ws-line);border-radius:20px}.theme-review-preview .ai-studio{display:block!important;min-height:0!important}.theme-review-preview .ai-studio-header{padding:0}.theme-review-results{padding:32px;background:white;color:#14243b;font:16px Arial,sans-serif}.theme-review-results li{margin:14px 0}.theme-review-preview:has(.workspace-appearance-option){container-type:inline-size}@container(max-width:640px){.theme-fixture-grid{grid-template-columns:minmax(0,1fr)}}@media(max-width:767px){.theme-review-preview.operating-shell{grid-template-columns:minmax(0,1fr)}.theme-review-preview .sidebar{display:none!important}.theme-fixture-content{padding:16px}.theme-fixture-grid{grid-template-columns:minmax(0,1fr)}}</style></head><body><div id="root"></div><script type="module" src="/review.js"></script></body></html>`;
const server = createServer((request, response) => {
  const path = new URL(request.url || "/", `http://127.0.0.1:${port}`).pathname;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'");
  if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405); response.end(); return; }
  const asset = path === "/review.js" ? [javascript, "text/javascript"] : path === "/review.css" ? [css, "text/css"] : path === "/fonts/geist-latin.woff2" ? [font, "font/woff2"] : path === "/" ? [html, "text/html"] : brandAssets.get(path) ?? null;
  if (!asset) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "Content-Type": asset[1] }); response.end(request.method === "HEAD" ? undefined : asset[0]);
});
server.listen(port, "127.0.0.1", () => console.log(`Midnight theme review: http://127.0.0.1:${port}/`));
