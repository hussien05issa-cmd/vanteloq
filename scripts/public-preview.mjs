// Loopback preview of the real public component. No workspace session or provider calls.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { build } from 'esbuild';
const bundle = await build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {LandingPage} from './app/page'; import DemoPage from './app/demo/page'; import HelpPage from './app/help/page'; import PricingPage from './app/pricing/page'; import CustomPlanPage from './app/custom-plan/page'; import ContactPage from './app/contact/page'; createRoot(document.getElementById('root')).render(location.pathname === '/demo' ? <DemoPage/> : location.pathname === '/help' ? <HelpPage/> : location.pathname === '/pricing' ? <PricingPage/> : location.pathname === '/custom-plan' ? <CustomPlanPage/> : location.pathname === '/contact' ? <ContactPage/> : <LandingPage start={()=>alert('Preview only. Account access is available on vanteloq.com.')}/>);`,resolveDir:process.cwd(),loader:'tsx'},plugins:[{name:'public-preview',setup(b){b.onLoad({filter:/app[\\/]page\.tsx$/},async args=>({contents:(await readFile(args.path,'utf8')).replace('function LandingPage(', 'export function LandingPage('),loader:'tsx'}));}}],define:{'process.env':'{}'},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',logLevel:'error'});
const styles = [...(await readFile('app/layout.tsx','utf8')).matchAll(/import "\.\/([^"\n]+\.css)"/g)].map(match=>match[1]);
createServer(async(req,res)=>{
 try {
  const path = new URL(req.url,'http://localhost').pathname;
  if(path==='/api/v1/custom-plan'){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({configured:false}));return;}
  if(path==='/preview.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].text);return;}
  if(path.startsWith('/brand/')||path.startsWith('/fonts/')){
   const root=resolve('public'),file=resolve(root,'.'+path);if(!file.startsWith(root+sep))throw new Error('Invalid path');
   res.setHeader('Content-Type',({'.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));return;
  }
  const css=(await Promise.all(styles.map(file=>readFile('app/'+file,'utf8')))).join('\n');
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vanteloq public design preview</title><style>${css}</style><div id="root"></div><script type="module" src="/preview.js"></script></html>`);
 }catch{res.writeHead(404);res.end('Not found');}
}).listen(5187,'127.0.0.1',()=>console.log('Public preview: http://127.0.0.1:5187'));



