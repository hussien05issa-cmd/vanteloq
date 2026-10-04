import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";
import { readFile, readdir } from "node:fs/promises";
import { claimPlaidConnection, savePlaidClaimSecret, exchangePlaidPublicToken, disconnectPlaid } from "../server/integrations/plaid.ts";
import type { VanteloqRuntimeEnv } from "../db/index.ts";

async function fixture(run:(db:D1Database)=>Promise<void>){
  const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('test')}}",d1Databases:{DB:crypto.randomUUID()}});
  const runtime=globalThis as typeof globalThis & {__vanteloqEnv?:VanteloqRuntimeEnv}; const before=runtime.__vanteloqEnv;
  try{
    const db=await mf.getD1Database("DB") as unknown as D1Database;
    for(const file of (await readdir(new URL("../drizzle/",import.meta.url))).filter(name=>/^\d{4}.*\.sql$/.test(name)).sort()) for(const sql of (await readFile(new URL(`../drizzle/${file}`,import.meta.url),"utf8")).split("--> statement-breakpoint").filter(sql=>sql.trim())) await db.prepare(sql).run();
    for(const org of ["one","two"]) await db.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES(?,'Test','Workspace','Workspace','test@example.invalid','Retail','Edmonton','Test','T5A1A1','[]',1,1)").bind(org).run();
    await db.prepare("INSERT INTO free_integration_selections VALUES('one','plaid','selected',1,9999999999)").run();
    runtime.__vanteloqEnv={DB:db,PLAID_CLIENT_ID:"fictional",PLAID_SECRET:"fictional",PLAID_ENV:"sandbox",PLAID_WEBHOOK_URL:"https://vanteloq.example/webhook",PLAID_REDIRECT_URI:"https://vanteloq.example/callback",INTEGRATION_ENCRYPTION_KEY:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"};
    await run(db);
  }finally{runtime.__vanteloqEnv=before;await mf.dispose();}
}
test("Plaid claims atomically require the current tenant/provider generation",()=>fixture(async db=>{
  await assert.rejects(claimPlaidConnection("two","selected"));
  assert.equal((await db.prepare("SELECT COUNT(*) count FROM integration_connections WHERE organization_id='two'").first<{count:number}>())?.count,0);
  const claim=await claimPlaidConnection("one","selected");
  assert.equal((await db.prepare("SELECT free_grant_id FROM integration_connections WHERE id=?").bind(claim.id).first<{free_grant_id:string}>())?.free_grant_id,"selected");
  await assert.rejects(claimPlaidConnection("one","selected"),{code:"PLAID_CONNECTION_IN_PROGRESS"});
  await db.prepare("UPDATE integration_connections SET status='revoked' WHERE id=?").bind(claim.id).run();
  await db.prepare("UPDATE free_integration_selections SET grant_id='replacement' WHERE organization_id='one'").run();
  await assert.rejects(claimPlaidConnection("one","selected"));
  const next=await claimPlaidConnection("one","replacement"); assert.equal(next.version,1);
}));
test("a stale secret write cannot overwrite a replacement bank authorization",()=>fixture(async db=>{
  const claim=await claimPlaidConnection("one","selected");
  await savePlaidClaimSecret({organizationId:"one",claim,freeGrantId:"selected",secretId:"first",accessTokenCiphertext:"first-encrypted",itemIdCiphertext:"first-item-encrypted",now:new Date()});
  await db.prepare("UPDATE integration_connections SET sync_version=1 WHERE id=?").bind(claim.id).run();
  await db.prepare("UPDATE integration_secrets SET id='winner',access_token_ciphertext='winner-encrypted' WHERE connection_id=?").bind(claim.id).run();
  await assert.rejects(savePlaidClaimSecret({organizationId:"one",claim,freeGrantId:"selected",secretId:"stale",accessTokenCiphertext:"stale-encrypted",itemIdCiphertext:"stale-item-encrypted",now:new Date()}),{code:"PLAID_CONNECTION_CLAIM_LOST"});
  assert.deepEqual(await db.prepare("SELECT id,access_token_ciphertext FROM integration_secrets WHERE connection_id=?").bind(claim.id).first(),{id:"winner",access_token_ciphertext:"winner-encrypted"});
}));
test("lost-claim cleanup preserves the winner and keeps separate authority when revocation fails",()=>fixture(async db=>{
  let removeFails=true, replacementId="";
  const fetcher=(async(input:RequestInfo|URL)=>{
    const path=new URL(String(input)).pathname;
    if(path==="/item/public_token/exchange") {
      const old=await db.prepare("SELECT id FROM integration_connections WHERE organization_id='one' AND source_namespace='legacy'").first<{id:string}>();assert.ok(old);
      replacementId=old.id;
      await db.prepare("UPDATE integration_connections SET status='connected',sync_version=1,external_account_ref='winner-item' WHERE id=?").bind(old.id).run();
      await db.prepare("INSERT INTO integration_secrets(id,organization_id,provider,connection_id,access_token_ciphertext,refresh_token_ciphertext,token_expires_at,created_at,updated_at) VALUES('winner','one','plaid',?,'winner-encrypted','winner-item-encrypted',9999999999,1,1)").bind(old.id).run();
      return Response.json({access_token:"old-fictional-token",item_id:"old-item"});
    }
    if(path==="/item/remove")return removeFails?Response.json({error_code:"INTERNAL_SERVER_ERROR"},{status:503}):Response.json({removed:true});
    throw Error("Unexpected provider request");
  }) as typeof fetch;
  await assert.rejects(exchangePlaidPublicToken("one","fictional-public",fetcher,"selected"),{code:"PLAID_CONNECTION_CLAIM_LOST"});
  assert.equal((await db.prepare("SELECT access_token_ciphertext FROM integration_secrets WHERE id='winner'").first<{access_token_ciphertext:string}>())?.access_token_ciphertext,"winner-encrypted");
  assert.equal((await db.prepare("SELECT status FROM integration_connections WHERE id=?").bind(replacementId).first<{status:string}>())?.status,"connected");
  const cleanup=await db.prepare("SELECT c.id,k.access_token_ciphertext FROM integration_connections c JOIN integration_secrets k ON k.connection_id=c.id WHERE c.source_namespace LIKE 'cleanup:%'").first<{id:string;access_token_ciphertext:string}>();assert.ok(cleanup);assert.notEqual(cleanup.access_token_ciphertext,"old-fictional-token");
  // Retry only the retained orphan, leaving an inactive legacy winner out of scope.
  await db.prepare("UPDATE integration_connections SET status='revoked' WHERE id=?").bind(replacementId).run();
  removeFails=false;await disconnectPlaid("one",fetcher);
  assert.equal(await db.prepare("SELECT id FROM integration_secrets WHERE connection_id=?").bind(cleanup.id).first(),null);
  assert.ok(await db.prepare("SELECT id FROM integration_secrets WHERE id='winner'").first());
}));
