import assert from "node:assert/strict";
import test from "node:test";
import { validateInquiry, inquiryConfiguration, deliverCustomPlanInquiry, CUSTOM_PLAN_NOTICE_VERSION, DEMO_INQUIRY_NOTICE_VERSION } from "../server/custom-plan-inquiry.ts";
import type { VanteloqRuntimeEnv } from "../db/index.ts";
const env={RESEND_API_KEY:"fixture-secret",CUSTOM_PLAN_INQUIRY_TO:"private-owner@example.com",TURNSTILE_SITE_KEY:"public-site-key",TURNSTILE_SECRET_KEY:"captcha-secret",TURNSTILE_ALLOWED_HOSTNAMES:"vanteloq.com"} as VanteloqRuntimeEnv;
const body={name:"Test owner",email:"visitor@example.com",company:"Example store",phone:"",needs:"We need a larger workspace for five retail locations.",website:"",consent:true,noticeVersion:CUSTOM_PLAN_NOTICE_VERSION,submissionId:"1a111111-1111-4111-8111-111111111111",token:"security-token"};
const json=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json"}});
const demoBody = () => ({ ...body, purpose: "demo", company: "", needs: "", noticeVersion: DEMO_INQUIRY_NOTICE_VERSION, consentSubmittedAt: new Date().toISOString() });
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
 for(const result of [json({error:"PRIVATE PROVIDER DETAIL"},401),json({}),json({id:" "}),json({id:123})]){
 await assert.rejects(()=>deliverCustomPlanInquiry(body,env,"vanteloq.com",(async url=>String(url).includes("siteverify")?json({success:true,hostname:"vanteloq.com",action:"custom-plan"}):result) as typeof fetch),/could not confirm delivery/);
 }
});

test("demo requests have a distinct notice and require only name, email and response consent", () => {
 const demo = demoBody();
 assert.equal(validateInquiry(demo).purpose, "demo");
 assert.equal(validateInquiry({ ...demo, needs: undefined, company: undefined, phone: undefined }).needs, "");
 assert.equal(validateInquiry({ ...demo, needs: "POS" }).needs, "POS");
 assert.equal(validateInquiry({ ...demo, needs: "x".repeat(3000) }).needs.length, 3000);
 for (const changes of [
  { name: "" }, { name: [] }, { email: "" }, { consent: false }, { consent: "true" }, { consent: 1 },
  { noticeVersion: CUSTOM_PLAN_NOTICE_VERSION }, { noticeVersion: DEMO_INQUIRY_NOTICE_VERSION + "-old" },
  { purpose: "demo\nBcc: attacker@example.com" }, { purpose: {} }, { company: "x".repeat(161) },
  { phone: "x".repeat(61) }, { needs: "x".repeat(3001) }, { needs: { record: "customer" } },
  { needs: "Question\u0000with an unsafe control" }, { name: "Owner\nBcc: other@example.com" },
 ]) assert.throws(() => validateInquiry({ ...demo, ...changes }));
 assert.throws(() => validateInquiry({ ...body, noticeVersion: DEMO_INQUIRY_NOTICE_VERSION }));
 assert.throws(() => validateInquiry({ ...body, purpose: "contact", needs: "POS" }));
});

test("demo payloads reject extra personal data, routing overrides and marketing enrollment", () => {
 const demo = demoBody();
 for (const changes of [
  { to: "attacker@example.com" }, { from: "attacker@example.com" }, { reply_to: "attacker@example.com" },
  { subject: "Injected subject" }, { ip: "192.0.2.1" }, { customerRecords: [] }, { cardNumber: "fixture" },
  { address: "Unnecessary street address" }, { newsletter: true }, { marketingConsent: true },
 ]) assert.throws(() => validateInquiry({ ...demo, ...changes }), /unsupported field/);
});

test("visitor consent timestamps are canonical UTC and bounded while legacy payloads stay valid", () => {
 const demo = demoBody();
 assert.equal(validateInquiry(demo).consentSubmittedAt, demo.consentSubmittedAt);
 for (const consentSubmittedAt of [undefined, null, "invalid", "2026-01-01", "2026-01-01T00:00:00+00:00", new Date(Date.now() + 6 * 60_000).toISOString(), new Date(Date.now() - 25 * 60 * 60_000).toISOString()]) {
  assert.throws(() => validateInquiry({ ...demo, consentSubmittedAt }));
 }
 assert.throws(() => validateInquiry({ ...body, consentSubmittedAt: demo.consentSubmittedAt }), /unsupported field/);
 assert.equal(validateInquiry(body).noticeVersion, CUSTOM_PLAN_NOTICE_VERSION);
 assert.equal(validateInquiry({ ...body, purpose: "contact", company: "" }).noticeVersion, CUSTOM_PLAN_NOTICE_VERSION);
});

test("a confirmed demo request emails only the owner with consent evidence and a scheduling purpose", async () => {
 const demo = demoBody(), calls: Array<{ url: string; init: RequestInit }> = [];
 const request = (async (url, init) => {
  calls.push({ url: String(url), init: init! });
  if (String(url) === "https://challenges.cloudflare.com/turnstile/v0/siteverify") return json({ success: true, hostname: "vanteloq.com", action: "custom-plan" });
  assert.equal(String(url), "https://api.resend.com/emails");
  return json({ id: "demo-provider-receipt" });
 }) as typeof fetch;
 assert.deepEqual(await deliverCustomPlanInquiry(demo, env, "vanteloq.com", request), { sent: true, reference: demo.submissionId });
 assert.equal(calls.length, 2);
 assert.deepEqual(JSON.parse(calls[0].init.body as string), { secret: env.TURNSTILE_SECRET_KEY, response: demo.token });
 const message = JSON.parse(calls[1].init.body as string);
 assert.deepEqual(Object.keys(message).sort(), ["from", "reply_to", "subject", "text", "to"]);
 assert.deepEqual(message.to, [env.CUSTOM_PLAN_INQUIRY_TO]);
 assert.equal(message.reply_to, demo.email);
 assert.equal(message.subject, "Vanteloq free demo request");
 assert.match(message.text, /Contact consent: demo-request-v2/);
 assert.ok(message.text.includes(`Visitor consent submitted at (UTC): ${demo.consentSubmittedAt}`));
 assert.match(message.text, /a response and demo scheduling, not marketing enrollment/);
 assert.match(message.text, /No appointment, subscription or payment was created/);
 assert.doesNotMatch(message.text, /security-token|fixture-secret|captcha-secret/);
});

test("demo retries refresh verification but keep the email payload and provider identity unchanged", async () => {
 const demo = demoBody(), messages: RequestInit[] = [], tokens: string[] = [];
 const request = (async (url, init) => {
  if (String(url).includes("siteverify")) {
   tokens.push(JSON.parse(init!.body as string).response);
   return json({ success: true, hostname: "vanteloq.com", action: "custom-plan" });
  }
  messages.push(init!);
  return json({ id: "same-demo-receipt" });
 }) as typeof fetch;
 await deliverCustomPlanInquiry(demo, env, "vanteloq.com", request);
 await deliverCustomPlanInquiry({ ...demo, token: "fresh-security-token" }, env, "vanteloq.com", request);
 assert.deepEqual(tokens, ["security-token", "fresh-security-token"]);
 assert.equal(messages[0].body, messages[1].body);
 const key = (init: RequestInit) => new Headers(init.headers).get("Idempotency-Key");
 assert.equal(key(messages[0]), key(messages[1]));
 assert.match(key(messages[0])!, /^vanteloq-inquiry-[a-f0-9]{64}$/);
 await deliverCustomPlanInquiry({ ...demo, needs: "Please focus on our existing POS." }, env, "vanteloq.com", request);
 assert.notEqual(key(messages[0]), key(messages[2]));
});

test("demo verification failures and missing delivery receipts never report success", async () => {
 const demo = demoBody();
 for (const verification of [{ success: false }, { success: true, hostname: "evil.example", action: "custom-plan" }, { success: true, hostname: "vanteloq.com", action: "demo" }]) {
  let calls = 0;
  await assert.rejects(() => deliverCustomPlanInquiry(demo, env, "vanteloq.com", (async () => { calls++; return json(verification); }) as typeof fetch), /fresh security check/);
  assert.equal(calls, 1);
 }
 for (const receipt of [{}, { id: "" }, { id: " " }, { id: false }]) {
  await assert.rejects(() => deliverCustomPlanInquiry(demo, env, "vanteloq.com", (async url => String(url).includes("siteverify") ? json({ success: true, hostname: "vanteloq.com", action: "custom-plan" }) : json(receipt)) as typeof fetch), /could not confirm delivery/);
 }
 let calls = 0;
 await assert.rejects(() => deliverCustomPlanInquiry({ ...demo, consent: false }, env, "vanteloq.com", (async () => { calls++; throw new Error("No provider should be called"); }) as typeof fetch), /Confirm that we may contact/);
 assert.equal(calls, 0);
});

test("demo delivery can retry an unconfirmed provider response without duplicate payloads or leaked errors", async () => {
 const demo = demoBody(), messages: RequestInit[] = [];
 const request = (async (url, init) => {
  if (String(url).includes("siteverify")) return json({ success: true, hostname: "vanteloq.com", action: "custom-plan" });
  messages.push(init!);
  return messages.length === 1 ? json({ error: "fixture-secret PRIVATE PROVIDER DETAIL" }, 503) : json({ id: "confirmed-demo-receipt" });
 }) as typeof fetch;
 await assert.rejects(() => deliverCustomPlanInquiry(demo, env, "vanteloq.com", request), error => {
  assert.equal((error as Error).message, "We could not confirm delivery. Your details are still in the form. Please retry.");
  return true;
 });
 assert.deepEqual(await deliverCustomPlanInquiry({ ...demo, token: "fresh-token" }, env, "vanteloq.com", request), { sent: true, reference: demo.submissionId });
 assert.equal(messages[0].body, messages[1].body);
 assert.equal(new Headers(messages[0].headers).get("Idempotency-Key"), new Headers(messages[1].headers).get("Idempotency-Key"));
});
