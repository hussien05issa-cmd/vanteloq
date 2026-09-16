import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

test("production workerd fetch delivers to the fixed endpoint and never follows redirects",async()=>{
  const bundle=await build({stdin:{contents:`import {receiveEmail} from './email-worker/worker.ts';
    export default {async fetch(request){let rejected=false;
      await receiveEmail({from:'fixture@example.invalid',to:'inbox-'+ 'a'.repeat(48)+'@documents.vanteloq.com',raw:request.body,rawSize:Number(request.headers.get('x-fixture-size')),setReject(){rejected=true;}},{DOCUMENT_EMAIL_SECRET:'a'.repeat(64)});
      return Response.json({rejected});}};`,resolveDir:fileURLToPath(new URL("../",import.meta.url)),sourcefile:"email-transport-fixture.ts",loader:"ts"},bundle:true,write:false,format:"esm",platform:"browser",target:"es2022"});
  let calls=0,redirect=false;
  const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:"2026-05-22",outboundService:async request=>{
    calls++;assert.equal(request.url,"https://vanteloq.com/api/v1/documents/email/deliver");
    assert.equal(request.method,"POST");assert.ok(request.headers.get("x-vanteloq-email-signature"));
    return redirect?new Response(null,{status:302,headers:{Location:"https://attacker.invalid"}}):Response.json({received:true});
  }});
  const mime=`MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=fixture\r\n\r\n--fixture\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=fictional.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from("%PDF-1.4\nFictional\n%%EOF").toString("base64")}\r\n--fixture--\r\n`;
  const invoke=()=>mf.dispatchFetch("https://worker.invalid",{method:"POST",headers:{"x-fixture-size":String(Buffer.byteLength(mime))},body:mime});
  try{
    assert.deepEqual(await (await invoke()).json(),{rejected:false});assert.equal(calls,1);
    redirect=true;assert.deepEqual(await (await invoke()).json(),{rejected:true});assert.equal(calls,2);
  }finally{await mf.dispose();}
});

test("actual workerd processes the advertised maximum MIME payload and rejects oversized input",{timeout:180000},async t=>{
  const bundle=await build({stdin:{contents:`import {receiveEmail} from './email-worker/worker.ts';
    export default {async fetch(request){let rejected='',delivered=0,decoded=0;const started=Date.now();
      await receiveEmail({from:'fixture@example.invalid',to:'inbox-'+ 'a'.repeat(48)+'@documents.vanteloq.com',raw:request.body,rawSize:Number(request.headers.get('x-fixture-size')),setReject(reason){rejected=reason;}},
      {DOCUMENT_EMAIL_SECRET:'a'.repeat(64)},async(url,options)=>{if(url!=='https://vanteloq.com/api/v1/documents/email/deliver'||options.redirect!=='manual')throw new Error('unsafe target');const body=JSON.parse(options.body);decoded=body.attachments.reduce((total,file)=>total+atob(file.content).length,0);delivered++;return Response.json({received:true});});
      return Response.json({delivered,decoded,rejected:Boolean(rejected),wallMs:Date.now()-started});}};`,resolveDir:fileURLToPath(new URL("../",import.meta.url)),sourcefile:"email-runtime-fixture.ts",loader:"ts"},bundle:true,write:false,format:"esm",platform:"browser",target:"es2022"});
  const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:"2026-05-22"});
  try{
    const size=10*1024*1024,bytes=Buffer.alloc(size,65);bytes.write("%PDF-1.4\n");
    const encoded=bytes.toString("base64").match(/.{1,76}/g).join("\r\n");
    const mime=`From: fixture@example.invalid\r\nTo: fixture@example.invalid\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=fixture\r\n\r\n--fixture\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=fictional.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n${encoded}\r\n--fixture--\r\n`;
    const rawSize=Buffer.byteLength(mime);assert.ok(rawSize<=15*1024*1024);
    const started=performance.now();const response=await mf.dispatchFetch("https://worker.invalid",{method:"POST",headers:{"x-fixture-size":String(rawSize)},body:mime});
    assert.equal(response.status,200);const result=await response.json();assert.equal(result.delivered,1);assert.equal(result.decoded,size);assert.equal(result.rejected,false);
    t.diagnostic(JSON.stringify({decodedBytes:size,rawBytes:rawSize,handlerWallMs:result.wallMs,totalWallMs:Math.round(performance.now()-started),note:"Local workerd acceptance only; wall time is not production CPU time or provider activation proof."}));
    const rejected=await mf.dispatchFetch("https://worker.invalid",{method:"POST",headers:{"x-fixture-size":String(15*1024*1024+1)},body:"oversized fixture"});
    assert.deepEqual(await rejected.json().then(({delivered,decoded,rejected})=>({delivered,decoded,rejected})),{delivered:0,decoded:0,rejected:true});
  }finally{await mf.dispose();}
});
