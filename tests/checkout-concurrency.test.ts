import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";
import { startStripeCheckout, closeCheckoutBeforeDeletion } from "../server/billing/checkout.ts";
import { PLANS, ADDONS } from "../server/entitlements/catalog.ts";
import { cleanupExpiredRateLimits } from "../server/rate-limit-maintenance.ts";
import { enforceRateLimit } from "../server/api.ts";

async function fixture() {
  const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('ok')}}", d1Databases: ["DB"] });
  const db = await mf.getD1Database("DB") as unknown as D1Database;
  await db.batch([
    "CREATE TABLE workspaces(id TEXT PRIMARY KEY)",
    "INSERT INTO workspaces VALUES ('org-a'),('org-b')",
    "CREATE TABLE tenant_subscriptions(organization_id TEXT PRIMARY KEY,stripe_subscription_id TEXT,status TEXT)",
    "CREATE TABLE account_deletion_jobs(user_id TEXT, organization_id TEXT, scope TEXT,stage TEXT)",
    "CREATE TABLE billing_checkout_attempts(organization_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,attempt_id TEXT UNIQUE NOT NULL,selection_key TEXT NOT NULL,request_body TEXT NOT NULL,session_id TEXT,created_at INTEGER NOT NULL)",
    "CREATE TABLE rate_limit_buckets(bucket_key TEXT PRIMARY KEY, scope TEXT,actor_hash TEXT,window_start INTEGER,request_count INTEGER,expires_at INTEGER)",
    "CREATE INDEX rate_limit_expiry_idx ON rate_limit_buckets(expires_at)",
  ].map(sql => db.prepare(sql)));
  (globalThis as typeof globalThis & {__vanteloqEnv: unknown}).__vanteloqEnv = {DB: db,STRIPE_SECRET_KEY:"sk_test_fixture_only",STRIPE_BILLING_WEBHOOK_SECRET:"whsec_fixture_only"};
  const sessions = new Map<string, Record<string, unknown>>();
  const cached = new Map<string, {body:string;id:string}>();
  let creates=0, expireCalls=0, loseNextResponse=false, completeOnExpire=false;
  const fetcher: typeof fetch = async (input, init) => {
    const url=new URL(String(input));
    assert.equal(url.origin,"https://api.stripe.com");
    if(url.pathname==="/v1/prices") {
      const lookup=url.searchParams.get("lookup_keys[]");
      const price=[...Object.values(PLANS),...Object.values(ADDONS)].flatMap(v=>[v.prices.month,v.prices.year]).find(p=>p.lookupKey===lookup)!;
      return Response.json({data:[{id:`price_${lookup!.replaceAll('_','')}`,lookup_key:lookup,unit_amount:price.amountCents,currency:"cad",active:true,recurring:{interval:"month"}}]});
    }
    if(url.pathname==="/v1/checkout/sessions") {
      const key=new Headers(init?.headers).get("Idempotency-Key")!;
      assert.match(key,/^vanteloq-checkout-/);
      const raw=String(init?.body), fields=new URLSearchParams(raw);
      let record=cached.get(key);
      if(record) assert.equal(record.body,raw,"Retries must preserve every parameter");
      else {
        const id=`cs_test_fixture${++creates}`;
        record={body:raw,id};cached.set(key,record);
        sessions.set(id,{id,status:"open",client_reference_id:fields.get("client_reference_id"),metadata:{vanteloq_checkout_attempt:fields.get("metadata[vanteloq_checkout_attempt]")},url:`https://checkout.stripe.com/c/pay/${id}`,subscription:null});
      }
      if(loseNextResponse) {loseNextResponse=false;throw new Error("Simulated interrupted provider response");}
      return Response.json(sessions.get(record.id));
    }
    const id=url.pathname.split('/')[4], session=sessions.get(id)!;
    assert.ok(session,`Unexpected checkout ${id}`);
    if(url.pathname.endsWith('/expire')) {
      expireCalls++;
      if(completeOnExpire) {session.status="complete";session.subscription="sub_fixture123";return Response.json({error:"already complete"},{status:400});}
      session.status="expired";session.url=null;
    }
    return Response.json(session);
  };
  const selection={organizationId:"org-a",userId:"user-a",email:"owner@example.invalid",plan:"starter" as const,interval:"month" as const,includeBookloq:false,customerId:null,origin:"https://vanteloq.example",database:db,fetcher};
  return {db,mf,fetcher,sessions,selection,stats:()=>({creates,expireCalls}),lose:()=>{loseNextResponse=true;},completeOnExpire:()=>{completeOnExpire=true;}};
}

test("20 concurrent checkout requests share one durable attempt and payable Stripe session",async()=>{
  const f=await fixture();try {
    const responses=await Promise.all(Array.from({length:20},()=>startStripeCheckout(f.selection)));
    assert.equal(new Set(responses.map(r=>r.url)).size,1);assert.equal(f.stats().creates,1);
    assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM billing_checkout_attempts").first<{n:number}>())?.n,1);
  }finally{await f.mf.dispose();}
});
test("changed plan expires the old session before creating another; racing selections leave one payable session",async()=>{
  const f=await fixture();try {
    await startStripeCheckout(f.selection);
    const results=await Promise.allSettled([startStripeCheckout({...f.selection,plan:"growth",includeBookloq:true}),startStripeCheckout({...f.selection,plan:"pro"})]);
    assert.ok(results.some(r=>r.status==="fulfilled"));
    assert.equal([...f.sessions.values()].filter(s=>s.status==="open").length,1);
    assert.ok(f.stats().expireCalls>=1);
  }finally{await f.mf.dispose();}
});
test("lost creation response recovers the same checkout with frozen email and return URLs",async()=>{
  const f=await fixture();try {
    f.lose();await assert.rejects(startStripeCheckout(f.selection),/interrupted/);
    const result=await startStripeCheckout({...f.selection,email:"changed@example.invalid",origin:"https://another.example"});
    assert.match(result.url,/fixture1$/);assert.equal(f.stats().creates,1);
  }finally{await f.mf.dispose();}
});
test("completed payment and completion racing expiration cannot start another charge",async()=>{
  const f=await fixture();try {
    await startStripeCheckout(f.selection); f.completeOnExpire();
    await assert.rejects(startStripeCheckout({...f.selection,plan:"pro"}));
    await assert.rejects(startStripeCheckout(f.selection),/payment is being confirmed/);
    assert.equal(f.stats().creates,1);
  }finally{await f.mf.dispose();}
});
test("an unknown attempt beyond Stripe retry retention remains blocked",async()=>{
  const f=await fixture();try {
    f.lose();await assert.rejects(startStripeCheckout(f.selection));
    await f.db.prepare("UPDATE billing_checkout_attempts SET created_at=1").run();
    await assert.rejects(startStripeCheckout(f.selection),/previous checkout/);assert.equal(f.stats().creates,1);
  }finally{await f.mf.dispose();}
});
test("deletion expires pending payment, blocks new attempts and preserves unresolved completed payments",async()=>{
  const f=await fixture();try {
    await startStripeCheckout(f.selection);
    await f.db.prepare("INSERT INTO account_deletion_jobs VALUES ('user-a','org-a','workspace','checking')").run();
    await closeCheckoutBeforeDeletion("org-a",null,f.db,f.fetcher);
    await assert.rejects(startStripeCheckout(f.selection));
    assert.equal([...f.sessions.values()].filter(s=>s.status==="open").length,0);
    assert.equal(f.stats().creates,1);
    await f.db.prepare("DELETE FROM account_deletion_jobs").run();
    await startStripeCheckout(f.selection);
    const last=[...f.sessions.values()].find(s=>s.status==="open")!;last.status="complete";last.subscription="sub_fixture123";
    await assert.rejects(closeCheckoutBeforeDeletion("org-a",null,f.db,f.fetcher),/payment is being confirmed/);
  }finally{await f.mf.dispose();}
});
test("organizations retain independent checkout sessions",async()=>{
  const f=await fixture();try {
    const a=await startStripeCheckout(f.selection), b=await startStripeCheckout({...f.selection,organizationId:"org-b",userId:"user-b"});
    assert.notEqual(a.url,b.url);assert.equal(f.stats().creates,2);
  }finally{await f.mf.dispose();}
});
test("an in-flight Stripe idempotency conflict retains the attempt for a safe retry",async()=>{
  const f=await fixture();try {
    let conflict=true;
    const fetcher:typeof fetch=async(input,init)=>{
      if(conflict && new URL(String(input)).pathname==="/v1/checkout/sessions") {conflict=false;return Response.json({error:"idempotency_key_in_use"},{status:409});}
      return f.fetcher(input,init);
    };
    await assert.rejects(startStripeCheckout({...f.selection,fetcher}));
    const before=await f.db.prepare("SELECT attempt_id FROM billing_checkout_attempts").first();
    await startStripeCheckout({...f.selection,fetcher});
    assert.deepEqual(await f.db.prepare("SELECT attempt_id FROM billing_checkout_attempts").first(),before);
    assert.equal(f.stats().creates,1);
  }finally{await f.mf.dispose();}
});
test("bounded expiry cleanup preserves live buckets and atomic concurrent increments",async()=>{
  const f=await fixture();try {
    const now=Math.floor(Date.now()/1000);
    await f.db.batch(Array.from({length:505},(_,i)=>f.db.prepare("INSERT INTO rate_limit_buckets VALUES (?, 'old','hash',1,1,?)").bind(`old-${i}`,now-1)));
    await Promise.all(Array.from({length:25},()=>enforceRateLimit("fixture","same-actor",25,3600)));
    assert.equal((await cleanupExpiredRateLimits(f.db,now)).removed,500);
    assert.equal((await cleanupExpiredRateLimits(f.db,now)).removed,5);
    assert.equal((await cleanupExpiredRateLimits(f.db,now)).removed,0);
    assert.equal((await f.db.prepare("SELECT request_count FROM rate_limit_buckets").first<{request_count:number}>())?.request_count,25);
    await assert.rejects(enforceRateLimit("fixture","same-actor",25,3600),/Too many/);
  }finally{await f.mf.dispose();}
});
