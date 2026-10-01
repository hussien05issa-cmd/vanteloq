// Loopback-only visual verification of the real BookLoQ component. All records
// come from an isolated test database; write operations are deliberately rejected.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { build } from "esbuild";
const bundle = await build({ stdin: { contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client'; import './app/bookloq-display.css';
  import ExecutiveOverview from './app/executive-overview'; import WorkspaceShowcase from './app/workspace-showcase'; import LinkedFilesPanel from './app/linked-files-panel'; import BookLoQWorkspace from './app/bookloq-workspace'; import ProductBrandLogo from './app/product-brand-logo'; import WorkspaceIcon from './app/workspace-icon';
  const announce=()=>alert('Local demonstration only. No customer data or external action.');
  createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).get('surface')==='marketing'?<WorkspaceShowcase/>:new URLSearchParams(location.search).get('surface')==='files'?<main style={{padding:'32px',maxWidth:1000,margin:'auto'}}><LinkedFilesPanel/></main>:<div className="app-shell operating-shell"><aside className="sidebar"><button className="brand"><ProductBrandLogo product="vanteloq"/><span className="brand-name">Vanteloq</span></button><div className="nav-group"><p>Sample Workspace</p>{['Dashboard','Sales','Inventory','BookLoQ','Integrations','Advisor'].map(name=><button key={name} className="nav-item" aria-current={name==='BookLoQ'?'page':undefined} onClick={announce}><WorkspaceIcon name={name}/><span className="nav-label">{name}</span></button>)}</div></aside><div className="main-panel"><div className="fixture-label">Local QA · Fictional records · No external actions</div>{new URLSearchParams(location.search).get('surface')==='dashboard'?<main className="content command-page"><header style={{marginBottom:24}}><h1 style={{fontSize:27,color:'#17263e',letterSpacing:'-.035em'}}>Good morning, Alex.</h1><p style={{color:'#4f6680'}}>Here's your business at a glance.</p></header><ExecutiveOverview currency="CAD" navigate={announce}/></main>:<BookLoQWorkspace initialSection={new URLSearchParams(location.search).get('section')==='cash'?'Cash Flow':'Overview'} activeLocationId={null} createTask={announce} navigate={announce} showNotice={announce}/>}</div></div>);
`, resolveDir: process.cwd(), loader: "tsx" }, plugins: [{ name: "local-data", setup(builder) {
  builder.onLoad({ filter: /app[\\/]supabase-browser\.ts$/ }, () => ({ contents: `export const apiFetch = (path, options) => fetch(path + (path.includes('?') ? '&' : '?') + 'empty=' + (new URLSearchParams(location.search).get('empty') || ''), options);`, loader: 'ts' }));
} }], define: { "process.env": "{}" }, bundle: true, write: false, outdir: "preview-memory", format: "esm", platform: "browser", jsx: "automatic", logLevel: "error" });
const styles = [...(await readFile("app/workspace-base-styles.ts", "utf8")).matchAll(/import "\.\/([^"\n]+\.css)"/g)].map(match => match[1]);
const sample = JSON.parse(await readFile("tests/fixtures/bookloq-preview.json", "utf8"));
// The forecast example is isolated from the ledger fixture and clearly labelled.
const scenario = await build({ stdin: { contents: 'export {bookloqDemo} from "./domain/bookloq-demo";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "esm", platform: "node" });
const { bookloqDemo } = await import(`data:text/javascript;base64,${Buffer.from(scenario.outputFiles[0].text).toString("base64")}`);
const statementModule = await build({ stdin: { contents: 'export {reviewedBankStatement,statementFingerprint} from "./domain/bank-statement";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "esm", platform: "node" });
const { reviewedBankStatement, statementFingerprint } = await import(`data:text/javascript;base64,${Buffer.from(statementModule.outputFiles[0].text).toString("base64")}`);
sample.bookloq.thirteenWeekCashFlow = bookloqDemo(600000, false, false);
const collectionsModule = await build({stdin:{contents:'export {buildCollectionsDashboard,filterCollections} from "./domain/collections-dashboard";',resolveDir:process.cwd(),loader:"ts"},bundle:true,write:false,format:"esm",platform:"node"});
const {buildCollectionsDashboard,filterCollections}=await import(`data:text/javascript;base64,${Buffer.from(collectionsModule.outputFiles[0].text).toString("base64")}`);
let preferences={};
const fixtureRows=Array.from({length:32},(_,i)=>({id:`fixture-${i}`,kind:i%3===0?"payable":"receivable",reference:(i%3===0?"BILL-":"INV-")+(1040+i),contactId:`c-${i%8}`,contactName:["Northside Retail","Blue River Goods","West Market","Atlas Supplies","Mason Studio","Parkside Co.","Cedar Wholesale","City Provisions"][i%8],invoiceDate:"2026-09-01",dueDate:["2026-09-01","2026-09-28","2026-10-02","2026-10-10","2026-10-18"][i%5],status:i===5?"disputed":"sent",approvalStatus:i%4===0?"pending":"not_required",totalCents:Math.round(43000+i*3754),paidCents:i%2?10000:0,currency:"CAD",updatedAt:1790409600000}));
const execModule = await build({stdin:{contents:'export {buildExecutiveReport} from "./server/executive-report"; export {executivePeriod} from "./domain/executive-metrics";',resolveDir:process.cwd(),loader:"ts"},bundle:true,write:false,format:"esm",platform:"node"});
const {buildExecutiveReport,executivePeriod}=await import(`data:text/javascript;base64,${Buffer.from(execModule.outputFiles[0].text).toString("base64")}`);
const port = Number(process.argv[2] || 5192);
createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path.startsWith("/api/")) {
      response.setHeader("Content-Type", "application/json");
      if (path === "/api/v1/bookloq/statements" && request.method === "POST") {
        let raw = "";
        for await (const chunk of request) { raw += chunk; if (raw.length > 400_000) throw new Error("Preview is too large"); }
        try {
          const body = JSON.parse(raw);
          if (body.action !== "preview") { response.statusCode = 405; response.end(JSON.stringify({ error: { message: "This local preview cannot import or undo records." } })); return; }
          const preview = reviewedBankStatement({ ...body, demoRecord: true }, "2026-09-16");
          response.end(JSON.stringify({ preview, previewFingerprint: await statementFingerprint(preview), statementCashEnabled: true })); return;
        } catch (error) { response.statusCode = 400; response.end(JSON.stringify({ error: { message: error.message } })); return; }
      }
      const params=new URL(request.url,"http://localhost").searchParams;
      if(path==="/api/v1/preferences") {if(request.method==="POST"){let raw="";for await(const chunk of request)raw+=chunk;const body=JSON.parse(raw);preferences=body.dashboardPreferences??{...preferences,collections:body.collectionsPreferences};}response.end(JSON.stringify({dashboardPreferences:preferences}));return;}
      if(path==="/api/v1/bookloq/collections") {const horizon=Number(params.get("horizon")||30),kind=params.get("kind")||"receivable",filter=params.get("filter")||"all";const {records,...report}=buildCollectionsDashboard(params.get("empty")==="1"?[]:fixtureRows,"2026-09-26","CAD",horizon);const filtered=filterCollections(records,kind,filter,report.asOf,horizon,params.get("q")||"");const page=Number(params.get("page")||0);response.end(JSON.stringify({report,records:filtered.slice(page*25,page*25+25),total:filtered.length,page,pageSize:25,demonstration:true}));return;}
      if(path==="/api/v1/command-centre") {
        const period=executivePeriod(params,"2026-09-27");
        const recorded=params.get("empty")!=="1";
        const trend=recorded?Array.from({length:7},(_,i)=>({date:`2026-09-${21+i}`,netSalesCents:100000+i*12000,grossProfitCents:40000+i*4800,transactionCount:100+i*12,averageTransactionCents:1000,unitsSold:120+i*14})):[];
        const metric=(value)=>({value,actuality:"actual",sourceSystem:"Fictional sales",sourceTimestamp:"2026-09-27T09:00:00Z",confidenceLevel:"high",limitations:[]});
        const metrics=recorded?{net_sales:metric(952000),gross_profit:metric(380800),gross_margin:metric(.4),transactions:metric(952),average_transaction:metric(1000),units:metric(1134)}:{};
        const report=buildExecutiveReport(period,{metrics,previous:null,trend,insights:[],reportingPeriod:{comparable:false}},null,"Review posted records to see financial results.","commerce");
        response.end(JSON.stringify({executiveReport:report}));return;
      }
      if(path==="/api/v1/linked-files") {response.end(JSON.stringify({providers:[{provider:"google-files",available:false},{provider:"microsoft-files",available:false}],connections:[],sources:[]}));return;}
      if (request.method !== "GET") { response.statusCode = 405; response.end(JSON.stringify({ error: { message: "Local preview is read only." } })); return; }
      if (path === "/api/v1/bookloq/statements") {
        response.end(JSON.stringify({ accounts: [{ id: "fictional-manual", name: "Fictional Statement Account", maskedNumber: "••••4821", currency: "CAD" }], documents: [{ id: "fictional-statement", fileName: "Fictional statement.pdf", documentType: "bank_statement", extractionReady: false }], imports: [{ id: "fictional-history", bankAccountId: "fictional-manual", startDate: "2026-08-01", endDate: "2026-08-31", rowCount: 2, inflowCents: 40000, outflowCents: 15000, closingBalanceCents: 125000 }], statementCashEnabled: true, boundary: "Local fictional review. No real document or bank account is used. This preview cannot import records.", extraction: null })); return;
      }
      response.end(JSON.stringify(path === "/api/v1/bookloq" ? sample : { integrations: [], canManageBankConnections: false })); return;
    }
    if (path === "/preview.js") { response.setHeader("Content-Type", "application/javascript"); response.end(bundle.outputFiles.find(file => file.path.endsWith(".js")).text); return; }
    if (path.startsWith("/brand/") || path.startsWith("/fonts/")) {
      const root = resolve("public"), file = resolve(root, "." + path);
      if (!file.startsWith(root + sep)) throw new Error("Invalid path");
      response.setHeader("Content-Type", ({ ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".svg": "image/svg+xml" })[extname(file)] || "application/octet-stream");
      response.end(await readFile(file)); return;
    }
    const css = (await Promise.all(styles.map(file => readFile("app/" + file, "utf8")))).join("\n") + "\n" + bundle.outputFiles.filter(file => file.path.endsWith(".css")).map(file => file.text).join("\n");
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BookLoQ · Local sample workspace</title><style>${css}\n.fixture-label{padding:12px 24px;color:#375777;background:#e7f0fa;font-size:13px}.main-panel{min-width:0}</style><div id="root"></div><script type="module" src="/preview.js"></script></html>`);
  } catch { response.statusCode = 404; response.end("Not found"); }
}).listen(port, "127.0.0.1", () => console.log(`BookLoQ preview: http://127.0.0.1:${port}`));
