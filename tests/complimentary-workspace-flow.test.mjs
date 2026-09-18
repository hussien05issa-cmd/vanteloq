import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { Miniflare } from "miniflare";
import { registerSupabaseTestServer } from "./helpers/supabase-loopback-transport.mjs";
const origin = "https://vanteloq.example";
const context = { waitUntil() {}, passThroughOnException() {} };
const email = "invited-owner@example.invalid", subject = "invited-owner-subject";
const offer = { id: "a385cc2c-566e-4d18-b939-94737813eb75", email, plan: "pro", bookloq: true, expiresAt: null };
const payload = { complimentaryId: offer.id, legalAccepted: true, termsVersion: "2026-09-05", privacyPolicyVersion: "2026-09-10", legalNoticeVersion: "account-creation-v2", timezone: "America/Edmonton" };
function headers(who = email, sub = subject, aal = "aal2") {
 const token = Buffer.from(JSON.stringify({ email: who, subject: sub, full_name: "Invited Owner", aal, session_id: "session:" + sub })).toString("base64url");
 return { authorization: "Bearer test." + token + ".signature", origin, "sec-fetch-site": "same-origin", "content-type": "application/json", accept: "application/json" };
}
test("complimentary workspaces require verified identity, MFA, legal acceptance and the matching private grant", async () => {
 const auth = createServer((req,res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i,"") ?? "";
  const p = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());
  res.writeHead(200,{"content-type":"application/json"});
  res.end(JSON.stringify({id:p.subject,email:p.email,email_confirmed_at:"2026-08-01T00:00:00Z",user_metadata:{full_name:p.full_name}}));
 });
 await new Promise(resolve => auth.listen(0,"127.0.0.1",resolve));
 const mf = new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",d1Databases:{DB:"complimentary-"+crypto.randomUUID()}});
 const db = await mf.getD1Database("DB");
 try {
  for(const file of (await readdir(new URL("../drizzle/",import.meta.url))).filter(x=>/^\d{4}.*\.sql$/.test(x)).sort()) {
   for(const sql of (await readFile(new URL("../drizzle/"+file,import.meta.url),"utf8")).split("--> statement-breakpoint").map(x=>x.trim()).filter(Boolean)) await db.prepare(sql).run();
  }
  const u=new URL("../dist/server/index.js",import.meta.url);u.searchParams.set("complimentary-test",crypto.randomUUID());
  const worker=(await import(u.href)).default;
  const env={DB:db,SUPABASE_URL:registerSupabaseTestServer(auth.address().port),SUPABASE_PUBLISHABLE_KEY:"test-publishable-key",
    VANTELOQ_COMPLIMENTARY_INVITATIONS:JSON.stringify([offer]),ASSETS:{fetch:async()=>new Response("Not found",{status:404})}};
  const call=(path,body,h=headers())=>worker.fetch(new Request(origin+path,{method:body?"POST":"GET",headers:h,...(body?{body:JSON.stringify(body)}:{})}),env,context);
  let response=await call("/api/v1/onboarding");assert.equal(response.status,200);let json=await response.json();
  assert.equal(json.complimentary.id,offer.id);assert.equal(json.complimentary.email,undefined);assert.equal(json.organization,null);
  response=await call("/api/v1/onboarding",undefined,headers("other@example.invalid","other"));assert.equal((await response.json()).complimentary,null);
  response=await call("/api/v1/onboarding",payload,headers("other@example.invalid","other"));assert.equal(response.status,403);
  response=await call("/api/v1/onboarding",payload,headers(email,subject,"aal1"));assert.equal(response.status,403);
  response=await call("/api/v1/onboarding",{...payload,legalAccepted:false});assert.equal(response.status,409);
  response=await call("/api/v1/onboarding",payload);assert.equal(response.status,201,await response.clone().text());
  const organization=(await response.json()).organization;
  const record=await db.prepare("SELECT business_name,legal_name,address,city,postal_code,source_mode FROM workspaces WHERE id=?").bind(organization.id).first();
  assert.equal(record.business_name,"My workspace");assert.equal(record.address,"");assert.equal(record.legal_name,"");assert.equal(record.source_mode,"connect_later");
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM complimentary_access WHERE organization_id=?").bind(organization.id).first()).n,1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM tenant_subscriptions").first()).n,0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM legal_acceptances WHERE organization_id=?").bind(organization.id).first()).n,1);
  response=await call("/api/v1/entitlements");assert.equal(response.status,200,await response.clone().text());json=await response.json();
  assert.equal(json.accessType,"complimentary");assert.equal(json.current.plan,"pro");assert.ok(json.current.features.includes("bookloq"));assert.equal(json.current.status,null);
  response=await call("/api/v1/billing/checkout",{plan:"pro",interval:"month",includeBookloq:true});assert.equal(response.status,409);assert.equal((await response.json()).error.code,"COMPLIMENTARY_ACCESS_INCLUDED");
  response=await call("/api/v1/onboarding",payload);assert.equal(response.status,409);
  response=await call("/api/v1/entitlements",undefined,headers(email,"replacement-subject"));assert.equal(response.status,403);
  env.VANTELOQ_COMPLIMENTARY_INVITATIONS=JSON.stringify([{...offer,plan:"starter",bookloq:false}]);
  json=await (await call("/api/v1/entitlements")).json();assert.equal(json.current.plan,"starter");assert.equal(json.current.features.includes("bookloq"),false);assert.equal(json.current.limits.users,3);
  env.VANTELOQ_COMPLIMENTARY_INVITATIONS=JSON.stringify([{...offer,expiresAt:"2020-01-01T00:00:00Z"}]);
  assert.equal((await (await call("/api/v1/entitlements")).json()).accessType,"none");
  env.VANTELOQ_COMPLIMENTARY_INVITATIONS="[]";
  assert.equal((await (await call("/api/v1/entitlements")).json()).accessType,"none");
  env.VANTELOQ_COMPLIMENTARY_INVITATIONS=JSON.stringify([offer]);
  await db.prepare("UPDATE complimentary_access SET active=0 WHERE grant_id=?").bind(offer.id).run();
  assert.equal((await (await call("/api/v1/entitlements")).json()).accessType,"none");
  assert.equal((await (await call("/api/v1/onboarding")).json()).complimentary,null);
  assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results.length,0);
 } finally { await mf.dispose();await new Promise(resolve=>auth.close(resolve)); }
});

