// Local UI-only fixture. It does not call a provider or production API.
import { createServer } from "node:http";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const bundle = await build({ entryPoints: [fileURLToPath(new URL("../tests/fixtures/provider-consent-preview.tsx", import.meta.url))], bundle: true, write: false, outfile: "fixture.js", format: "esm", platform: "browser", jsx: "automatic", logLevel: "error" });
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://127.0.0.1:5191").pathname;
  const asset = bundle.outputFiles.find(file => file.path.endsWith(path === "/fixture.css" ? ".css" : ".js"));
  if (path === "/fixture.js" || path === "/fixture.css") { response.writeHead(200, { "content-type": path.endsWith(".css") ? "text/css" : "application/javascript" }); return response.end(asset.text); }
  response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
  response.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Vanteloq connector notice verification</title><link rel="stylesheet" href="/fixture.css"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#142e50;background:#edf3fb}main{max-width:800px;margin:auto;padding:32px}main button,main select{font:inherit;margin:10px;padding:12px}main h1{font-size:24px}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
});
server.listen(5191, "127.0.0.1", () => console.log("Connector notice fixture: http://127.0.0.1:5191"));
