// Loopback-only interaction check. No customer data, provider calls or persistence.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { build } from "esbuild";

const bundle = await build({ stdin: { contents: `
import React,{Component,useState} from 'react';import {createRoot} from 'react-dom/client';
import PageRecovery from './app/error';import NotFound from './app/not-found';
class Boundary extends Component{state={failed:false};static getDerivedStateFromError(){return {failed:true};}render(){return this.state.failed?<PageRecovery error={new Error('LOCAL_QA_ONLY 500 internal SQL fixture')} reset={()=>{this.props.onReset();this.setState({failed:false});}}/>:this.props.children;}}
function Content({fail}){if(fail)throw new Error('LOCAL_QA_ONLY 500 internal SQL fixture');return <main style={{padding:32,fontFamily:'Geist, sans-serif'}}><h1>View recovered</h1><p role="status">Fictional preview only. Retry completed without a network request or a financial action.</p></main>;}
function Preview(){const [fail,setFail]=useState(true);return new URLSearchParams(location.search).has('missing')?<NotFound/>:<Boundary onReset={()=>setFail(false)}><Content fail={fail}/></Boundary>;}
createRoot(document.getElementById('root')).render(<Preview/>);
`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,outdir:"memory",format:"esm",platform:"browser",jsx:"automatic",logLevel:"error",define:{"process.env":'{}',"process.env.NODE_ENV":'"production"'}});
const root=resolve("public");
createServer(async(req,res)=>{
 try{const url=new URL(req.url,'http://127.0.0.1:5201');
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vanteloq recovery QA</title><link rel="stylesheet" href="/preview.css"></head><body style="margin:0"><div id="root"></div><script type="module" src="/preview.js"></script></body></html>');return;}
 if(url.pathname==='/preview.js'||url.pathname==='/preview.css'){const ending=url.pathname.endsWith('.js')?'.js':'.css';res.setHeader('Content-Type',ending==='.js'?'text/javascript':'text/css');res.end(bundle.outputFiles.find(f=>f.path.endsWith(ending))?.contents??'');return;}
 const path=resolve(root,'.'+decodeURIComponent(url.pathname));if(!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
 res.setHeader('Content-Type',({'.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(path)]??'application/octet-stream');res.end(await readFile(path));
 }catch{res.writeHead(404);res.end('Not found');}
}).listen(5201,'127.0.0.1',()=>console.log('Read-only recovery QA: http://127.0.0.1:5201/'));
