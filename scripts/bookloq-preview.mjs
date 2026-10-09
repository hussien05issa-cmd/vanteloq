// Loopback-only visual verification of the real BookLoQ component. All records
// come from an isolated test database; write operations are deliberately rejected.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { build } from "esbuild";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
const bundle = await build({ stdin: { contents: `
  import React,{useState} from 'react'; import {createRoot} from 'react-dom/client'; import './app/bookloq-display.css';
  import ExecutiveOverview from './app/executive-overview'; import WorkspaceShowcase from './app/workspace-showcase'; import LinkedFilesPanel from './app/linked-files-panel'; import BookLoQWorkspace from './app/bookloq-workspace'; import ProductBrandLogo from './app/product-brand-logo'; import WorkspaceIcon from './app/workspace-icon';
  const params=new URLSearchParams(location.search);
  const qa=params.get('scenario')||'sample';
  const sections={cash:'Cash Flow',settings:'Settings','month-end':'Month-End',transactions:'Transactions',overview:'Overview',invoices:'Invoicing'};
  const initialSection=sections[params.get('section')]||({periods:'Month-End',receipts:'Transactions','setup-empty':'Settings','setup-bank-only':'Settings'}[qa])||'Overview';
  function Preview(){
    const [notice,setNotice]=useState('');
    const announce=()=>setNotice('This local preview is read only. No records, tasks, messages or external connections were changed.');
    const surface=params.get('surface');
    if(surface==='marketing') return <WorkspaceShowcase/>;
    if(surface==='files') return <main style={{padding:'32px',maxWidth:1000,margin:'auto'}}><LinkedFilesPanel/></main>;
    return <div className="app-shell operating-shell" data-workspace-theme={params.get("theme") === "light" ? "light" : "dark"}><aside className="sidebar"><button className="brand" onClick={announce}><ProductBrandLogo product="vanteloq"/><span className="brand-name">Vanteloq</span></button><div className="nav-group"><p>Fictional QA Workspace</p>{['Dashboard','Sales','Inventory','BookLoQ','Integrations','Advisor'].map(name=><button key={name} className="nav-item" aria-current={name==='BookLoQ'?'page':undefined} onClick={announce}><WorkspaceIcon name={name}/><span className="nav-label">{name}</span></button>)}</div></aside><div className="main-panel"><div className="fixture-label"><strong>Local QA · Fictional records · Read only</strong><span>Scenario: {qa}</span><nav aria-label="Local QA scenarios">{[['setup-empty','Empty setup'],['setup-bank-only','Bank-only setup'],['periods','Period controls'],['receipts','Receipt evidence']].map(([key,name])=><a key={key} href={'?scenario='+key}>{name}</a>)}</nav></div>{notice&&<div className="fixture-notice" role="alert">{notice}<button type="button" aria-label="Dismiss local notice" onClick={()=>setNotice('')}>Close</button></div>}{surface==='dashboard'?<main className="content command-page"><header style={{marginBottom:24}}><h1 style={{fontSize:27,color:'var(--ws-ink)'}}>Fictional business overview</h1><p style={{color:'var(--ws-muted)'}}>Local calculation and interface verification.</p></header><ExecutiveOverview currency="CAD" navigate={announce}/></main>:<BookLoQWorkspace initialSection={initialSection} activeLocationId={null} createTask={announce} navigate={announce} showNotice={message=>setNotice(message)}/>}</div></div>;
  }
  createRoot(document.getElementById('root')).render(<Preview/>);
`, resolveDir: process.cwd(), loader: "tsx" }, plugins: [{ name: "local-data", setup(builder) {
  builder.onLoad({ filter: /app[\\/]supabase-browser\.ts$/ }, () => ({ contents: `export const apiFetch = (path, options) => {const url=new URL(path,location.origin); if(url.origin!==location.origin)return Promise.reject(new Error('External requests are unavailable in local QA.')); const params=new URLSearchParams(location.search);url.searchParams.set('empty',params.get('empty')||'');url.searchParams.set('scenario',params.get('scenario')||'sample');return fetch(url,options);};`, loader: 'ts' }));
} }], define: { "process.env": "{}" }, bundle: true, write: false, outdir: "preview-memory", format: "esm", platform: "browser", jsx: "automatic", logLevel: "error" });
const styles = [...(await readFile("app/workspace-base-styles.ts", "utf8")).matchAll(/import "\.\/([^"\n]+\.css)"/g)].map(match => match[1]);
const sample = JSON.parse(await readFile("tests/fixtures/bookloq-preview.json", "utf8"));
// The forecast example is isolated from the ledger fixture and clearly labelled.
const scenario = await build({ stdin: { contents: 'export {bookloqDemo} from "./domain/bookloq-demo";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "esm", platform: "node" });
const { bookloqDemo } = await import(`data:text/javascript;base64,${Buffer.from(scenario.outputFiles[0].text).toString("base64")}`);
const statementModule = await build({ stdin: { contents: 'export {reviewedBankStatement,statementFingerprint} from "./domain/bank-statement";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "esm", platform: "node" });
const { reviewedBankStatement, statementFingerprint } = await import(`data:text/javascript;base64,${Buffer.from(statementModule.outputFiles[0].text).toString("base64")}`);
sample.bookloq.thirteenWeekCashFlow = bookloqDemo(600000, false, false);
const advertisingModule = await build({ stdin: { contents: 'export {buildBookloqAdvertisingSpend} from "./domain/bookloq-advertising-spend";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "esm", platform: "node" });
const { buildBookloqAdvertisingSpend } = await import(`data:text/javascript;base64,${Buffer.from(advertisingModule.outputFiles[0].text).toString("base64")}`);
const qaSync = Math.floor(Date.now() / 1000);
sample.bookloq.advertisingSpend = buildBookloqAdvertisingSpend({baseCurrency:"CAD",period:{start:"2026-09-01",end:"2026-09-30"},nowSeconds:qaSync,budgets:[],rows:[{selectionId:"fictional-meta-cad",accountRef:"act_123456",accountName:"Fictional retail advertising",scopeKind:"organization",locationId:null,metricDate:"2026-09-27",amountMinor:18475,currency:"CAD",reportingTimezone:"America/Edmonton",updatedAt:qaSync,lastSyncedAt:qaSync},{selectionId:"fictional-meta-usd",accountRef:"act_987654",accountName:"Fictional US advertising",scopeKind:"organization",locationId:null,metricDate:"2026-09-27",amountMinor:6250,currency:"USD",reportingTimezone:"America/New_York",updatedAt:qaSync,lastSyncedAt:qaSync}]});
const collectionsModule = await build({stdin:{contents:'export {buildCollectionsDashboard,filterCollections} from "./domain/collections-dashboard";',resolveDir:process.cwd(),loader:"ts"},bundle:true,write:false,format:"esm",platform:"node"});
const {buildCollectionsDashboard,filterCollections}=await import(`data:text/javascript;base64,${Buffer.from(collectionsModule.outputFiles[0].text).toString("base64")}`);
sample.bookloq.payrollSource={provider:"deel",status:"staged",configuredEnvironment:"sandbox",recordEnvironment:"unverified",connections:[{id:"fictional-deel",accountName:"Fictional payroll account",status:"connected",promotionStatus:"staging",lastSuccessfulSyncAt:qaSync,mappedLocationCount:1,reportCount:2,latestReportPeriod:{start:"2026-09-01",end:"2026-09-30"},lastImportedAt:qaSync,reviewReasons:["Imported source reports require review before accounting or payment."]}],boundary:"Fictional source metadata only. Report environment and payroll approval are unverified. No wage, liability, payment, tax or journal amount was created."};
const preferences={};
const fixtureRows=Array.from({length:32},(_,i)=>({id:`fixture-${i}`,kind:i%3===0?"payable":"receivable",reference:(i%3===0?"BILL-":"INV-")+(1040+i),contactId:`c-${i%8}`,contactName:["Northside Retail","Blue River Goods","West Market","Atlas Supplies","Mason Studio","Parkside Co.","Cedar Wholesale","City Provisions"][i%8],invoiceDate:"2026-09-01",dueDate:["2026-09-01","2026-09-28","2026-10-02","2026-10-10","2026-10-18"][i%5],status:i===5?"disputed":"sent",approvalStatus:i%4===0?"pending":"not_required",totalCents:Math.round(43000+i*3754),paidCents:i%2?10000:0,currency:"CAD",updatedAt:1790409600000}));
const execModule = await build({stdin:{contents:'export {buildExecutiveReport} from "./server/executive-report"; export {executivePeriod} from "./domain/executive-metrics";',resolveDir:process.cwd(),loader:"ts"},bundle:true,write:false,format:"esm",platform:"node"});
const {buildExecutiveReport,executivePeriod}=await import(`data:text/javascript;base64,${Buffer.from(execModule.outputFiles[0].text).toString("base64")}`);
// Fixtures are generated in memory. No database, credentials or production provider is used.
const fixtureHelpers = await build({stdin:{contents:'export {buildThirteenWeekCashFlow} from "./domain/thirteen-week-cash-flow";export {buildBusinessCashSummary} from "./domain/bookloq-cash-management";',resolveDir:process.cwd(),loader:"ts"},bundle:true,write:false,format:"esm",platform:"node"});
const {buildThirteenWeekCashFlow,buildBusinessCashSummary}=await import(`data:text/javascript;base64,${Buffer.from(fixtureHelpers.outputFiles[0].text).toString("base64")}`);
const receiptDocument = await PDFDocument.create();
const receiptFont = await receiptDocument.embedFont(StandardFonts.Helvetica);
const receiptPage = receiptDocument.addPage([420,540]);
const receiptLines = ["FICTIONAL QA RECEIPT", "No purchase or payment occurred.", "Fictional Office Supplies", "Date: 2026-10-04", "Reference: QA-RECEIPT-0001", "Paper and stationery: CAD 40.00", "GST (5%): CAD 2.00", "Total: CAD 42.00", "Paid by fictional bank card", "For local interface verification only."];
receiptLines.forEach((text,index)=>receiptPage.drawText(text,{x:32,y:495-index*34,size:index===0?18:12,font:receiptFont,color:rgb(.12,.16,.24)}));
const receiptPdf=Buffer.from(await receiptDocument.save());
function readOnly(response) { response.statusCode=405;response.end(JSON.stringify({error:{code:"LOCAL_QA_READ_ONLY",message:"Local QA is read only. This action was not saved, posted, matched, sent or connected. Refresh to retain the unchanged fictional records."}})); }
function fixtureFor(name, empty = false) {
  const payload=structuredClone(sample),data=payload.bookloq;
  data.organization.name="Fictional BookLoQ QA";
  if (name.startsWith("setup-") || empty) {
    data.configured=name==="setup-bank-only";
    data.settings=null; data.advertisingSpend=undefined; data.payrollSource=undefined;
    for(const key of ["accountCatalog","transactions","transactionMatches","matchCandidates","categoryRules","documents","banks","reconciliations","bills","invoices","contacts","alerts","journals","periods","closeItems","budgets","audit","planningSchedule"]) data[key]=[];
    data.statements.accounts=[];
    for(const key of ["trialBalance","profitAndLoss","balanceSheet"]) for(const field of Object.keys(data.statements[key])) if(typeof data.statements[key][field]==="number")data.statements[key][field]=0;
    for(const key of Object.keys(data.summary)) if(typeof data.summary[key]==="number" || data.summary[key]===null)data.summary[key]=null;
    Object.assign(data.summary,{cashSource:"unavailable",bankCashStatus:"needs_bank_connection"});
    data.ledgerAccess={available:false,reason:"Fictional setup scenario: no accounting profile or posted ledger exists."};
    data.transactionAccess={available:false,reason:"No fictional transactions are loaded in this setup scenario."};
    data.documentSummary={total:0,invoices:0,receipts:0,needsReview:0,extractionConfigured:false};
    data.integrations={banking:"not_connected",pos:"not_connected",payroll:"manual_journals_only",receiptCapture:"upload_available",taxFiling:"not_available"};
    data.thirteenWeekCashFlow=buildThirteenWeekCashFlow({asOf:"2026-10-04",openingCashCents:null,safetyThresholdCents:0,actualTransactions:[],forecastItems:[],confirmedPurchasingObligationsCents:0,decisionBlocks:["bookloq_inactive"]});
    data.cashActivity={days30:buildBusinessCashSummary([],"2026-10-04",30),days90:buildBusinessCashSummary([],"2026-10-04",90),months12:buildBusinessCashSummary([],"2026-10-04",365)};
    if (name==="setup-bank-only") {
      data.accountCatalog=[{id:"qa-imported-bank",code:"BANK-QA",name:"Fictional imported bank account",accountType:"asset",accountSubtype:"bank",normalBalance:"debit",systemKey:null}];
      data.banks=[{id:"qa-bank",name:"Fictional imported bank account",accountType:"chequing",institutionName:"Local QA Bank",maskedNumber:"••••1234",currency:"CAD",provider:"manual_statement",liveBalanceCents:null,availableBalanceCents:null,bookBalanceCents:0,availableCreditCents:null,connectionStatus:"not_connected",balanceState:"unavailable",lastSyncAt:null,lastReconciledAt:null,demoRecord:1,accountCode:"BANK-QA",accountName:"Fictional imported bank account"}];
    }
  }
  if (name==="periods") {
    data.periods=[{id:"qa-oct",label:"October 2026",startDate:"2026-10-01",endDate:"2026-10-31",status:"open",lockedAt:null},{id:"qa-sep",label:"September 2026",startDate:"2026-09-01",endDate:"2026-09-30",status:"locked",lockedAt:1791072000},{id:"qa-aug",label:"August 2026",startDate:"2026-08-01",endDate:"2026-08-31",status:"review",lockedAt:null},{id:"qa-jul",label:"July 2026 (empty checklist)",startDate:"2026-07-01",endDate:"2026-07-31",status:"open",lockedAt:null}];
    data.closeItems=[...["Bank review","Receivable review","Tax review"].map((title,i)=>({id:"qa-oct-"+i,periodId:"qa-oct",itemKey:"control-"+i,title:"October: "+title,status:i===2?"blocked":"complete",dueDate:"2026-10-31",blocker:i===2?"Fictional supporting tax detail needs review":"",completedAt:i===2?null:1791072000})),...["Bank review","Account review"].flatMap((title,i)=>["sep","aug"].map(month=>({id:`qa-${month}-${i}`,periodId:"qa-"+month,itemKey:"control-"+i,title:(month==="sep"?"September: ":"August: ")+title,status:"complete",dueDate:month==="sep"?"2026-09-30":"2026-08-31",blocker:"",completedAt:1791072000})))];
    data.summary.monthEndCompletionRate=2/3;
  }
  if(name==="receipts") {
    data.transactions=[{...data.transactions[0],id:"qa-transaction",transactionDate:"2026-10-04",postingDate:"2026-10-04",description:"Fictional Office Supplies",originalDescription:"QA CARD PURCHASE",amountCents:-4200,currency:"CAD",taxAmountCents:200,sourceSystem:"bank_statement",externalSourceId:"QA-BANK-0001",locationRef:"all",reconciliationStatus:"unreconciled",categorizationStatus:"uncategorized",confidenceBasisPoints:0,accountCode:null,accountName:null}];
    data.transactionMatches=[];data.alerts=[];data.closeItems=[];data.bills=[];
    data.documents=[{id:"qa-receipt-pdf",fileName:"Fictional office supplies receipt.pdf"},{id:"qa-receipt-denied",fileName:"Fictional permission-denied receipt.pdf"},{id:"qa-receipt-quarantined",fileName:"Fictional scan-status-changed receipt.pdf"}].map(document=>({...document,documentType:"receipt",status:"review",securityState:"clean",extractionStatus:"not_requested",createdAt:1791072000}));
    data.matchCandidates=[{transactionId:"qa-transaction",candidateId:"qa-receipt-pdf",kind:"receipt",label:"Fictional office supplies receipt.pdf",confidenceBasisPoints:8000,reasons:["Fictional amount and date candidate; original review required"],requiresConfirmation:true}];
    data.documentSummary={total:3,invoices:0,receipts:3,needsReview:3,extractionConfigured:false};
    data.summary.unreconciledCount=1;data.summary.uncategorizedCount=1;data.summary.missingReceiptsCount=1;
  }
  return payload;
}
const port = Number(process.argv[2] || 5199);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Select a valid loopback preview port.");
createServer(async (request, response) => {
  try {
    if (!["127.0.0.1:" + port, "localhost:" + port].includes(request.headers.host ?? "")) { response.writeHead(403); response.end("Loopback host required"); return; }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const requestUrl = new URL(request.url, "http://127.0.0.1:" + port);
    const path = requestUrl.pathname;
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
      const params=requestUrl.searchParams;
      const empty = params.get("empty") === "1" || params.get("scenario")?.startsWith("setup-");
      if (request.method !== "GET") { readOnly(response); return; }
      if(path==="/api/v1/preferences") {response.end(JSON.stringify({dashboardPreferences:preferences}));return;}
      if(path==="/api/v1/bookloq/collections") {const horizon=Number(params.get("horizon")||30),kind=params.get("kind")||"receivable",filter=params.get("filter")||"all";const {records,...report}=buildCollectionsDashboard(empty?[]:fixtureRows,"2026-09-26","CAD",horizon);const filtered=filterCollections(records,kind,filter,report.asOf,horizon,params.get("q")||"");const page=Number(params.get("page")||0);response.end(JSON.stringify({report,records:filtered.slice(page*25,page*25+25),total:filtered.length,page,pageSize:25,demonstration:true}));return;}
      if(path==="/api/v1/command-centre") {
        const period=executivePeriod(params,"2026-09-27");
        const recorded=!empty;
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
      if (path === "/api/v1/documents" && params.has("id")) {
        const id=params.get("id");
        if (id === "qa-receipt-denied") { response.statusCode=403; response.end(JSON.stringify({error:{code:"DOCUMENT_DOWNLOAD_DENIED",message:"Fictional permission check: receipt download is not allowed. No match was saved."}})); return; }
        if (id === "qa-receipt-quarantined") { response.statusCode=423; response.end(JSON.stringify({error:{code:"DOCUMENT_QUARANTINED",message:"Fictional scan check: this receipt is quarantined. No match was saved."}})); return; }
        if (id !== "qa-receipt-pdf") {response.statusCode=404;response.end(JSON.stringify({error:{message:"Fictional receipt not found."}}));return;}
        response.setHeader("Content-Type","application/pdf");response.setHeader("Content-Disposition",'inline; filename="fictional-office-supplies-receipt.pdf"');response.end(receiptPdf);return;
      }
      if (path === "/api/v1/bookloq") {response.end(JSON.stringify(fixtureFor(params.get("scenario") || "sample", empty)));return;}
      if (path === "/api/v1/integrations") {response.end(JSON.stringify({integrations:[],canManageBankConnections:false}));return;}
      response.statusCode=404;response.end(JSON.stringify({error:{code:"LOCAL_QA_UNAVAILABLE",message:"This endpoint is outside the fictional local QA fixture."}}));return;
    }
    if (path === "/preview.js") { response.setHeader("Content-Type", "application/javascript"); response.end(bundle.outputFiles.find(file => file.path.endsWith(".js")).text); return; }
    if (path.startsWith("/brand/") || path.startsWith("/fonts/")) {
      const root = resolve("public"), file = resolve(root, "." + path);
      if (!file.startsWith(root + sep)) throw new Error("Invalid path");
      response.setHeader("Content-Type", ({ ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".svg": "image/svg+xml" })[extname(file)] || "application/octet-stream");
      response.end(await readFile(file)); return;
    }
    const css = (await Promise.all(styles.map(file => readFile("app/" + file, "utf8")))).join("\n") + "\n" + bundle.outputFiles.filter(file => file.path.endsWith(".css")).map(file => file.text).join("\n") + "\n" + (await Promise.all(["workspace-appearance.css", "workspace-contrast.css"].map(file => readFile("app/" + file, "utf8")))).join("\n");
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BookLoQ · Local sample workspace</title><style>${css}\n.fixture-label{padding:12px 24px;color:var(--ws-ink);background:var(--ws-raised);font-size:13px;display:grid;gap:8px}.fixture-label nav{display:flex;flex-wrap:wrap;gap:14px}.operating-shell[data-workspace-theme] .fixture-label a{color:var(--ws-blue)!important;text-decoration:underline}.fixture-notice{padding:16px 24px;background:var(--ws-warning-bg);color:var(--ws-ink);display:flex;justify-content:space-between;gap:12px}.fixture-notice button{flex-shrink:0}.main-panel{min-width:0}</style><div id="root"></div><script type="module" src="/preview.js"></script></html>`);
  } catch { response.statusCode = 404; response.end("Not found"); }
}).listen(port, "127.0.0.1", () => console.log(`BookLoQ preview: http://127.0.0.1:${port}`));
