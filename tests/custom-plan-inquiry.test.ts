import assert from "node:assert/strict";
import test from "node:test";
import { validateInquiry, inquiryConfiguration, deliverCustomPlanInquiry, CUSTOM_PLAN_NOTICE_VERSION } from "../server/custom-plan-inquiry.ts";
import type { VanteloqRuntimeEnv } from "../db/index.ts";
const env={RESEND_API_KEY:"fixture-secret",CUSTOM_PLAN_INQUIRY_TO:"private-owner@example.com",TURNSTILE_SITE_KEY:"public-site-key",TURNSTILE_SECRET_KEY:"captcha-secret",TURNSTILE_ALLOWED_HOSTNAMES:"vanteloq.com"} as VanteloqRuntimeEnv;
const body={name:"Test owner",email:"visitor@example.com",company:"Example store",phone:"",needs:"We need a larger workspace for five retail locations.",website:"",consent:true,noticeVersion:CUSTOM_PLAN_NOTICE_VERSION,submissionId:"1a111111-1111-4111-8111-111111111111",token:"security-token"};
const json=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json"}});
test("public inquiry configuration never exposes delivery credentials or recipient",()=>{
 assert.deepEqual(inquiryConfiguration(env,"vanteloq.com"),{configured:true,siteKey:"public-site-key",action:"custom-plan"});
 assert.deepEqual(inquiryConfiguration(env,"evil.example"),{configured:false});
 assert.deepEqual(inquiryConfiguration({...env,RESEND_API_KEY:""},"vanteloq.com"),{configured:false});
});
test("inquiries require consent, valid bounded fields and a closed payload schema",()=>{
 for(const changes of [{consent:false},{noticeVersion:"old"},{to:"attacker@example.com"},{website:"bot"},{email:"name@example.com\nBcc: x@evil.test"},{needs:"short"},{needs:"x".repeat(3001)},{submissionId:"invalid"},{purpose:"other"},{company:""}]){
  assert.throws(()=>validateInquiry({...body,...changes}));
 }
 assert.equal(validateInquiry({...body,purpose:"contact",company:""}).purpose,"contact");
 assert.equal(validateInquiry({...body,email:" VISITOR@EXAMPLE.COM "}).email,"visitor@example.com");
});
test("delivery uses a fixed private recipient and a stable retry identity, without enrolling marketing",async()=>{
 const sends:RequestInit[]=[];
 const request=(async(url,init)=>{if(String(url).includes("siteverify"))return json({success:true,hostname:"vanteloq.com",action:"custom-plan"});sends.push(init!);return json({id:"email-receipt"});}) as typeof fetch;
 assert.deepEqual(await deliverCustomPlanInquiry(body,env,"vanteloq.com",request),{sent:true,reference:body.submissionId});
 await deliverCustomPlanInquiry({...body,token:"new-security-token"},env,"vanteloq.com",request);
 const sent=JSON.parse(sends[0].body as string);
 assert.deepEqual(sent.to,["private-owner@example.com"]);assert.equal(sent.reply_to,body.email);
 assert.equal(sent.from,"Vanteloq <noreply@vanteloq.com>");
 assert.match(sent.text,/not marketing enrollment/);assert.doesNotMatch(sent.text,/security-token|fixture-secret|captcha-secret/);
 assert.equal(new Headers(sends[0].headers).get("Idempotency-Key"),new Headers(sends[1].headers).get("Idempotency-Key"));
 await deliverCustomPlanInquiry({...body,needs:body.needs+" We also need BookLoQ."},env,"vanteloq.com",request);
 assert.notEqual(new Headers(sends[0].headers).get("Idempotency-Key"),new Headers(sends[2].headers).get("Idempotency-Key"));
});
test("failed or mismatched security checks never reach email delivery",async()=>{
 for(const verification of [{success:false},{success:true,hostname:"evil.example",action:"custom-plan"},{success:true,hostname:"vanteloq.com",action:"login"}]){
 let calls=0;
 await assert.rejects(()=>deliverCustomPlanInquiry(body,env,"vanteloq.com",(async()=>{calls++;return json(verification);}) as typeof fetch),/fresh security check/);
 assert.equal(calls,1);
 }
});
test("delivery errors are sanitized and a provider receipt is mandatory",async()=>{
 for(const result of [json({error:"PRIVATE PROVIDER DETAIL"},401),json({})]){
 await assert.rejects(()=>deliverCustomPlanInquiry(body,env,"vanteloq.com",(async url=>String(url).includes("siteverify")?json({success:true,hostname:"vanteloq.com",action:"custom-plan"}):result) as typeof fetch),/could not confirm delivery/);
 }
});
