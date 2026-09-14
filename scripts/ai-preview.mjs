// Loopback-only interactive fixture. All displayed analysis is explicitly fictional.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const bundle = await build({entryPoints:['tests/fixtures/advisor-preview.tsx'],bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',logLevel:'error'});
const names=['globals','operating','theme','brand','design-v2','readability','experience','workspace-design','vanteloq-ai-brand','typography','product-demo','interface-polish','reference-theme'];
const server = createServer(async(request,response)=>{
 if(request.url==='/brand/vanteloq-ai-nexus.png'){response.setHeader('Content-Type','image/png');response.end(await readFile('public/brand/vanteloq-ai-nexus.png'));return;}
 if(request.url==='/fonts/geist-latin.woff2'){response.setHeader('Content-Type','font/woff2');response.end(await readFile('public/fonts/geist-latin.woff2'));return;}
 if(request.url==='/preview.js'){response.setHeader('Content-Type','application/javascript');response.end(bundle.outputFiles[0].text);return;}
 const css=(await Promise.all(names.map(name=>readFile('app/'+name+'.css','utf8')))).join('\n');
 response.setHeader('Content-Type','text/html; charset=utf-8');
 response.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vanteloq AI design preview</title><style>'+css+' body{margin:0}.operating-shell{display:block;min-height:0}.fixture-nav{display:flex;gap:20px;flex-wrap:wrap;padding:14px 24px;background:#102c49;color:white;font:12px system-ui}.fixture-nav a{color:#c7d9ff}</style><nav class="fixture-nav">LOCAL PREVIEW · FICTIONAL DATA <a href="?state=welcome">Welcome</a><a href="?state=thinking">Thinking</a><a href="?state=answer">Reply</a><a href="?state=pending">Setup pending</a></nav><div id="root"></div><script type="module" src="/preview.js"></script></html>');
});
server.listen(5186,'127.0.0.1',()=>console.log('AI visual fixture: http://127.0.0.1:5186'));
