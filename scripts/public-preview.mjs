// Loopback preview of the real public component. No workspace session or provider calls.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { build } from 'esbuild';
import { publicSurfaceCss } from '../build/public-surface-css.mjs';
const port=Number(process.env.PORT || 5187);
const bundle = await build({stdin:{contents:`import React, {useState} from 'react'; import AuthPanel from './app/auth-panel'; import SecureOnboardingFlow from './app/secure-onboarding-flow'; import {createRoot} from 'react-dom/client'; import LandingPage from './app/homepage-landing'; import RetailPage from './app/solutions/retail/page'; import InterfaceMotion from './app/interface-motion'; import {GoogleAnalyticsConsent} from './app/google-analytics-consent'; import DemoPage from './app/demo/page'; import HelpPage from './app/help/page'; import PricingPage from './app/pricing/page'; import CustomPlanPage from './app/custom-plan/page'; import ContactPage from './app/contact/page'; function Preview(){const [mode,setMode]=useState(location.pathname==='/signup'?'signup':location.pathname==='/signin'?'signin':null); return location.pathname==='/setup'?<SecureOnboardingFlow accountName='Avery Chen' accountEmail='avery@example.com' complete={()=>{}} signOut={()=>{}}/>:<>{mode&&<AuthPanel initialMode={mode} close={()=>setMode(null)} authenticated={()=>{}}/>}{location.pathname === '/solutions/retail' ? <RetailPage/> : location.pathname === '/demo' ? <DemoPage/> : location.pathname === '/help' ? <HelpPage/> : location.pathname === '/pricing' ? <PricingPage/> : location.pathname === '/custom-plan' ? <CustomPlanPage/> : location.pathname === '/contact' ? <ContactPage/> : <LandingPage start={setMode}/>}<InterfaceMotion/><GoogleAnalyticsConsent/></>;} createRoot(document.getElementById('root')).render(<Preview/>);`,resolveDir:process.cwd(),loader:'tsx'},plugins:[{name:'public-preview',setup(b){b.onLoad({filter:/app[\\/]page\.tsx$/},async args=>({contents:(await readFile(args.path,'utf8')).replace('function LandingPage(', 'export function LandingPage('),loader:'tsx'}));}}],define:{'process.env':'{}'},external:['/fonts/*','tailwindcss'],bundle:true,write:false,outdir:'../../output/public-preview-assets',format:'esm',platform:'browser',jsx:'automatic',logLevel:'error'});
const styles = [...(await readFile('app/layout.tsx','utf8')).matchAll(/import "\.\/([^"\n]+\.css)(\?public-surface)?"/g)].map(match=>({file:match[1],project:Boolean(match[2])}));
createServer(async(req,res)=>{
 try {
  const path = new URL(req.url,'http://localhost').pathname;
  if(path==='/responsive') { const width=Math.min(1440,Math.max(320,Number(new URL(req.url,'http://localhost').searchParams.get('width'))||390));res.setHeader('Content-Type','text/html');res.end(`<html><meta name="viewport" content="width=device-width"><title>Responsive preview at ${width}px</title><body style="margin:0;background:#d8e3f0"><iframe title="Responsive Vanteloq" src="/" style="border:0;display:block;width:${width}px;height:844px"></iframe></body></html>`);return; }
  if(path.startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({configured:false}));return;}
  if(path==='/preview.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles.find(file=>file.path.endsWith('.js')).text);return;}
  if(path.startsWith('/brand/')||path.startsWith('/fonts/')||path.startsWith('/integrations/')){
   const root=resolve('public'),file=resolve(root,'.'+path);if(!file.startsWith(root+sep))throw new Error('Invalid path');
   res.setHeader('Content-Type',({'.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));return;
  }
  const css=(await Promise.all(styles.map(async({file,project})=>{const css=await readFile('app/'+file,'utf8');return project?publicSurfaceCss(css,file):css;}))).join('\n')+'\n'+(bundle.outputFiles.find(file=>file.path.endsWith('.css'))?.text??'');
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vanteloq public design preview</title><style>${css}</style><div id="root"></div><script type="module" src="/preview.js"></script></html>`);
 }catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log('Public preview: http://127.0.0.1:'+port));



