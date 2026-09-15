// Read-only loopback viewer of real components and verified, isolated API output.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { build } from "esbuild";
const fixtureRoot = resolve(process.argv[2] || "../../output/financial-test-pack");
const bookloq = JSON.parse(await readFile(resolve(fixtureRoot,"verified-bookloq.json"),"utf8"));
const retail = JSON.parse(await readFile(resolve(fixtureRoot,"verified-retail.json"),"utf8"));
const bundle = await build({ stdin: { contents: `
import React,{useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';
import BookLoQWorkspace from './app/bookloq-workspace';import RetailIntelligencePanel from './app/retail-intelligence-panel';import WorkspaceSkeleton from './app/workspace-skeleton';
const note=()=>alert('Isolated financial QA. No changes to a real workspace.');
function App(){const [tab,setTab]=useState('bookloq'),[report,setReport]=useState(null);useEffect(()=>{fetch('/retail.json').then(r=>r.json()).then(setReport)},[]);
return <div className="app-shell operating-shell qa-financial-shell"><main className="main-panel"><header className="fixture-label"><div><strong>Northline QA Retail</strong><p>Fictional test records · Isolated from Supplement World</p></div><nav aria-label="Test views">{['bookloq','retail','loading'].map(t=><button key={t} aria-pressed={tab===t} onClick={()=>setTab(t)}>{t==='bookloq'?'BookLoQ':t==='retail'?'Retail Intelligence':'Loading Preview'}</button>)}</nav></header>{tab==='bookloq'?<BookLoQWorkspace initialSection="Overview" activeLocationId={null} createTask={note} navigate={note} showNotice={note}/>:tab==='retail'&&report?<section className="content"><RetailIntelligencePanel report={report} currency="CAD" demo access={{inventory:true,customers:true,labour:true,profit:true,costs:true,expiry:true,edit:false}}/></section>:<WorkspaceSkeleton label="Loading your workspace"/>}</main></div>}
createRoot(document.getElementById('root')).render(<App/>);
`,resolveDir:process.cwd(),loader:"tsx" },plugins:[{name:"isolated-api",setup(builder){builder.onLoad({filter:/app[\\/]supabase-browser\.ts$/},()=>({contents:"export const apiFetch = (...args) => fetch(...args);",loader:"ts"}));}}],define:{"process.env":"{}"},bundle:true,write:false,format:"esm",platform:"browser",jsx:"automatic",logLevel:"error"});
const styles=[...(await readFile("app/layout.tsx","utf8")).matchAll(/import "\.\/([^"\n]+\.css)"/g)].map(m=>m[1]);
createServer(async(req,res)=>{
  try {
    const path=new URL(req.url,"http://127.0.0.1").pathname;
    if(req.method!=="GET"){res.writeHead(405);res.end("This QA viewer is read only.");return;}
    if(path.startsWith('/api/')){res.setHeader("Content-Type","application/json");res.end(JSON.stringify(path==='/api/v1/bookloq'?bookloq:{integrations:[],canManageBankConnections:false}));return;}
    if(path==='/retail.json'){res.setHeader("Content-Type","application/json");res.end(JSON.stringify(retail));return;}
    if(path==='/preview.js'){res.setHeader("Content-Type","application/javascript");res.end(bundle.outputFiles[0].text);return;}
    if(path.startsWith('/brand/')||path.startsWith('/fonts/')){const root=resolve('public'),file=resolve(root,'.'+path);if(!file.startsWith(root+sep))throw Error('Invalid path');res.setHeader('Content-Type',({'.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));return;}
    const css=(await Promise.all(styles.map(s=>readFile('app/'+s,'utf8')))).join('\n');
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vanteloq Financial QA</title><style>'+css+'\n.qa-financial-shell{display:block}.qa-financial-shell .main-panel{margin:0;min-width:0}.fixture-label{padding:20px 24px;background:#eaf1f9;color:#19334f;display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px}.fixture-label p{margin:5px 0 0;color:#49617a}.fixture-label nav{display:flex;gap:8px;flex-wrap:wrap}.fixture-label button{padding:10px 14px;min-height:44px;border:1px solid #bdc9d8;border-radius:10px;background:#f3f7fc;color:#19334f}.fixture-label button[aria-pressed=true]{background:#245a97;color:#f6f9fd}</style><div id="root"></div><script type="module" src="/preview.js"></script></html>');
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(5200,'127.0.0.1',()=>console.log('Isolated financial QA: http://127.0.0.1:5200'));
