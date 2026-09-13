import assert from "node:assert/strict";
import test from "node:test";
import {createEnvironment,context,origin} from "./helpers/retail-worker-fixture.mjs";

test("public contact route delivers only after same-origin, bounded payload, consent and captcha checks",async()=>{
 const {worker,environment,dispose}=await createEnvironment();
 const oldFetch=globalThis.fetch;let sent=0;
 Object.assign(environment,{RESEND_API_KEY:"fixture-secret",CUSTOM_PLAN_INQUIRY_TO:"private-owner@example.com",TURNSTILE_SITE_KEY:"public-key",TURNSTILE_SECRET_KEY:"captcha-secret",TURNSTILE_ALLOWED_HOSTNAMES:"vanteloq.example"});
 const body={name:"Visitor",email:"visitor@example.com",company:"Example store",needs:"We need five locations and a larger team.",consent:true,noticeVersion:"custom-plan-contact-v1",submissionId:"11111111-1111-4111-8111-111111111111",website:"",token:"test-token"};
 const post=(data=body,changes={})=>worker.fetch(new Request(origin+"/api/v1/custom-plan",{method:"POST",headers:{origin,"sec-fetch-site":"same-origin","content-type":"application/json","cf-connecting-ip":"192.0.2.1",...changes},body:JSON.stringify(data)}),environment,context);
 try {
 const providerFetch=async(url,init)=>{
  if(String(url).includes("turnstile/v0/siteverify"))return Response.json({success:true,hostname:"vanteloq.example",action:"custom-plan"});
  if(String(url)==="https://api.resend.com/emails"){const message=JSON.parse(init.body);assert.deepEqual(message.to,["private-owner@example.com"]);sent++;return Response.json({id:"test-receipt"});}
  return oldFetch(url,init);
 };
 const config=await worker.fetch(new Request(origin+"/api/v1/custom-plan"),environment,context);
 assert.equal(config.status,200);assert.match(config.headers.get("cache-control"),/no-store/);
 assert.deepEqual(await config.json(),{configured:true,siteKey:"public-key",action:"custom-plan"});
 assert.equal((await post(body,{origin:"https://attacker.example","sec-fetch-site":"cross-site"})).status,403);
 assert.equal(sent,0);
 assert.equal((await post({...body,needs:"x".repeat(17000)},{"cf-connecting-ip":"192.0.2.2"})).status,413);
 assert.equal((await post({...body,consent:false},{"cf-connecting-ip":"192.0.2.3"})).status,400);
 globalThis.fetch=providerFetch;
 const ok=await post();assert.equal(ok.status,202,await ok.clone().text());assert.deepEqual(await ok.json(),{sent:true,reference:body.submissionId});
 assert.equal(sent,1);
 for(let i=0;i<4;i++)assert.equal((await post()).status,202);
 assert.equal((await post()).status,429);assert.equal(sent,5);
 for(const path of ["/custom-plan","/contact","/privacy","/terms","/cookies","/legal","/subprocessors","/data-processing","/pricing"]){
  const page=await worker.fetch(new Request(origin+path,{headers:{accept:"text/html"}}),environment,context);
  assert.equal(page.status,200,path);
  const html=await page.text();assert.doesNotMatch(html,/hussienissa@lexedgeconsulting\.com|private-owner@example\.com|fixture-secret|captcha-secret/);
 }
 } finally {globalThis.fetch=oldFetch;await dispose();}
});
