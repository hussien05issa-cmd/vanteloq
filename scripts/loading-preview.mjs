// Loopback-only visual QA of real presentation components. No credentials or writes.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { build } from "esbuild";
import { publicSurfaceCss } from "../build/public-surface-css.mjs";

const port = Number(process.argv[2] || 5203);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid loopback port.");
const bundle = await build({ stdin: { contents: `
  import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
  import {LandingPage} from './app/page'; import WorkspaceSkeleton from './app/workspace-skeleton';
  import BookLoQSkeleton from './app/bookloq-skeleton'; import InterfaceMotion from './app/interface-motion';
  import {setMotionPreference} from './app/use-motion-preference';
  const params=new URLSearchParams(location.search),screen=params.get('screen')||'hero';
  function Preview(){ const [notice,setNotice]=useState(''); const section=params.get('section')||'Overview';
    return <><div className="loading-qa"><span>Local visual QA · Placeholder shapes only · Read only</span><div><button onClick={()=>setMotionPreference(false)}>Motion off</button><button onClick={()=>setMotionPreference(true)}>Motion on</button></div>{notice&&<p role="status">{notice}</p>}</div>
      {screen==='hero'?<LandingPage start={()=>setNotice('Account actions are unavailable in this local visual preview.')}/>:<div className="operating-shell"><main>{screen==='bookloq'?<BookLoQSkeleton section={section}/>:<WorkspaceSkeleton variant="overview" label="Loading executive overview"/>}</main></div>}<InterfaceMotion/></>;
  } createRoot(document.getElementById('root')).render(<Preview/>);
`, resolveDir: process.cwd(), loader: "tsx" }, plugins: [{ name: "loading-qa", setup(builder) {
  builder.onLoad({ filter: /app[\\/]page\.tsx$/ }, async args => ({ contents: (await readFile(args.path, "utf8")).replace("function LandingPage(", "export function LandingPage("), loader: "tsx" }));
} }], define: { "process.env": "{}" }, external: ["/fonts/*", "tailwindcss"], bundle: true, write: false, outdir: "preview-memory", format: "esm", platform: "browser", jsx: "automatic", logLevel: "error" });
const styles = [...(await readFile("app/layout.tsx", "utf8")).matchAll(/import "\.\/([^"\n]+\.css)(\?public-surface)?"/g)].map(match => ({ file: match[1], project: Boolean(match[2]) }));

createServer(async (request, response) => {
  try {
    if (!["127.0.0.1:" + port, "localhost:" + port].includes(request.headers.host ?? "")) { response.writeHead(403); response.end("Loopback host required"); return; }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
    const url = new URL(request.url, "http://127.0.0.1:" + port), path = url.pathname;
    if (request.method !== "GET") { response.writeHead(405, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: { message: "This local visual preview is read only." } })); return; }
    if (path.startsWith("/api/")) { response.writeHead(503, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: { message: "Live sources are unavailable in local visual QA." } })); return; }
    if (path === "/preview.js") { response.setHeader("Content-Type", "application/javascript"); response.end(bundle.outputFiles.find(file => file.path.endsWith(".js")).text); return; }
    if (path === "/responsive") {
      const width = Math.min(1600, Math.max(320, Number(url.searchParams.get("width")) || 390));
      const target = new URLSearchParams({ screen: ["hero", "bookloq", "overview"].includes(url.searchParams.get("screen")) ? url.searchParams.get("screen") : "hero", section: url.searchParams.get("section") || "Overview" });
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vanteloq responsive QA</title><body style="margin:0;background:#dce5f0"><iframe title="Vanteloq responsive preview" src="/?' + target.toString() + '" style="display:block;border:0;width:' + width + 'px;height:100vh;min-height:844px"></iframe></body></html>'); return;
    }
    if (["/brand/", "/fonts/", "/integrations/"].some(prefix => path.startsWith(prefix))) {
      const root = resolve("public"), file = resolve(root, "." + path);
      if (!file.startsWith(root + sep)) throw new Error("Invalid path");
      response.setHeader("Content-Type", ({ ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".svg": "image/svg+xml" })[extname(file)] || "application/octet-stream");
      response.end(await readFile(file)); return;
    }
    const hero = !url.searchParams.has("screen") || url.searchParams.get("screen") === "hero";
    const css = (await Promise.all(styles.map(async ({ file, project }) => { const source = await readFile("app/" + file, "utf8"); return hero && project ? publicSurfaceCss(source, file) : source; }))).join("\n") + "\n" + bundle.outputFiles.filter(file => file.path.endsWith(".css")).map(file => file.text).join("\n");
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vanteloq hero and loading QA</title><style>${css}\n.loading-qa{padding:10px 16px;background:#eef2f9;color:#263b5b;display:flex;gap:12px;flex-wrap:wrap;align-items:center;font:12px Arial,sans-serif}.loading-qa>div{display:flex;gap:8px}.loading-qa button{min-height:36px;padding:8px 12px;background:white;border:1px solid #bccbe0;border-radius:8px}.operating-shell{display:block}.operating-shell>main{min-width:0;max-width:1500px;margin:auto}</style><div id="root"></div><script type="module" src="/preview.js"></script></html>`);
  } catch { response.statusCode = 404; response.end("Preview resource unavailable"); }
}).listen(port, "127.0.0.1", () => console.log(`Hero and loading preview: http://127.0.0.1:${port}`));
