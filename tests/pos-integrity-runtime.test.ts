import { commerceSourceAuthority } from "../server/integrations/source-authority.ts";
import { verifiedPosPublicationSql } from "../server/integrations/pos-publication.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { posSqliteFixture } from "./helpers/pos-sqlite-fixture.ts";
import { getDb, type VanteloqRuntimeEnv } from "../db/index.ts";
import { workspaces } from "../db/schema.ts";
import { runSync } from "../server/integrations/sync/shopify-pos.ts";
import { saveShopifyToken, SHOPIFY_ONLINE_LOCATION_REF } from "../server/integrations/shopify-pos.ts";
import { order, money } from "./pos-financial-integrity.test.ts";

for (const provider of ["shopify","shopify-pos"] as const) test(`${provider} copied sync preserves exact financial snapshots across updates, replay, failures and lease loss`, {timeout:120000}, async t => {
  const fixture = await posSqliteFixture();
  const {database} = fixture;
  const runtime = globalThis as typeof globalThis & {__vanteloqEnv?:VanteloqRuntimeEnv};
  const oldEnv=runtime.__vanteloqEnv, oldFetch=globalThis.fetch;
  t.after(async()=>{globalThis.fetch=oldFetch;runtime.__vanteloqEnv=oldEnv;fixture.close();});
  runtime.__vanteloqEnv={ DB:database, INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,19).toString("base64"),SHOPIFY_CLIENT_ID:"fixture",SHOPIFY_CLIENT_SECRET:"fixture",
    SHOPIFY_COMMERCE_REDIRECT_URI:"https://example.invalid/api/v1/integrations/shopify/callback",SHOPIFY_COMMERCE_WEBHOOK_URL:"https://example.invalid/api/v1/integrations/shopify/webhook",
    SHOPIFY_REDIRECT_URI:"https://example.invalid/api/v1/integrations/shopify-pos/callback",SHOPIFY_WEBHOOK_URL:"https://example.invalid/api/v1/integrations/shopify-pos/webhook" };
  await database.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES ('fixture-owner','owner@example.invalid','Fixture',1,1)").run();
  for(const id of ["fixture-org","other-org"]) await database.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,currency,timezone,created_at,updated_at) VALUES (?,'Fixture','Fixture','Fixture','fixture@example.invalid','Retail','Edmonton','Fixture','T5A1A1','[]','CAD','UTC',1,1)").bind(id).run();
  await database.prepare(`INSERT INTO integration_connections(id,organization_id,provider,source_namespace,status,domain_prefix,external_account_ref,data_promotion_status,created_at,updated_at)
    VALUES ('shop','fixture-org',?,'fixture','connected','fixture.myshopify.com','fixture.myshopify.com','approved',1,1)` ).bind(provider).run();
  await database.prepare(`INSERT INTO integration_location_mappings(id,organization_id,provider,connection_id,external_location_ref,external_name,status,last_seen_at,created_at,updated_at)
    VALUES ('map','fixture-org',?,'shop',?,'Fixture source','mapped',1,1,1)` ).bind(provider,provider === 'shopify' ? SHOPIFY_ONLINE_LOCATION_REF : 'pos-location').run();
  await database.prepare("INSERT INTO organization_locations(id,organization_id,name,country_code,address_line_1,locality,administrative_area,timezone,currency,created_at,updated_at) VALUES ('local','fixture-org','Fixture','CA','Fixture','Edmonton','AB','UTC','CAD',1,1)").run();
  await database.prepare("UPDATE integration_location_mappings SET local_location_id='local' WHERE id='map'").run();
  const authority=()=>commerceSourceAuthority({organizationId:"fixture-org",localLocationIds:["local"],factFamily:"sales"});
  await saveShopifyToken("fixture-org","shop","fixture-access","fixture-refresh",new Date(Date.now()+3600000),provider);
  const organization=(await getDb().select().from(workspaces)).find(row=>row.id==="fixture-org")!;
  const context={organizationId:"fixture-org",userId:"fixture-owner",organization};
  const state={orders:[order()],currency:"CAD",orderMore:false,steal:false};
  globalThis.fetch=(async(input,init)=>{
    const request=input instanceof Request?input:new Request(input,init),url=new URL(request.url);
    assert.equal(url.origin,"https://fixture.myshopify.com","Provider transport is fictional and isolated");
    const body=await request.json() as {query:string;variables?:{orderQuery?:string}};
    if(body.query.includes("query VanteloqShop {")) return Response.json({data:{shop:{id:"shop",name:"Fixture",myshopifyDomain:"fixture.myshopify.com",currencyCode:state.currency}}});
    const pageInfo={hasNextPage:false,endCursor:null};
    if(body.query.includes("query VanteloqShopifyOrders")) { assert.equal(body.variables?.orderQuery,provider === "shopify" ? "source_name:web" : "source_name:pos"); return Response.json({data:{orders:{nodes:state.orders,pageInfo:{hasNextPage:state.orderMore,endCursor:state.orderMore?"next":null}}}}); }
    if(body.query.includes("query VanteloqShopifyProductVariants")) return Response.json({data:{productVariants:{nodes:["p1","p2"].map((id,i)=>({id,sku:i?"B":"A",title:"Default Title",price:"20",product:{id:"product"+i,title:"Fixture",status:"ACTIVE"},inventoryItem:{unitCost:{amount:"12",currencyCode:"CAD"},inventoryLevels:{nodes:[],pageInfo}}})),pageInfo}}});
    if(body.query.includes("query VanteloqShopifyCustomers")) {
      if(state.steal) await database.prepare("UPDATE integration_connections SET sync_version=sync_version+1,sync_lease_owner='new-owner',sync_lease_expires_at=?,data_promotion_status='approved',last_error_code=NULL WHERE id='shop'").bind(Math.floor(Date.now()/1000)+600).run();
      return Response.json({data:{customers:{nodes:[],pageInfo}}});
    }
    throw Error("Unexpected provider query");
  }) as typeof fetch;
  const sync=()=>runSync(new Request("https://example.invalid/sync",{method:"POST"}),crypto.randomUUID(),context,{connectionId:"shop"},"scheduled",provider);
  const metrics=async()=> (await database.prepare("SELECT net_sales_cents net,cost_of_goods_cents cost,units_sold units,transaction_count transactions FROM daily_business_metrics WHERE organization_id='fixture-org' AND source_connection_id='shop'").all<{net:number;cost:number;units:number;transactions:number}>()).results ?? [];
  const verified=async()=>Boolean((await database.prepare(`SELECT ${verifiedPosPublicationSql("c")} verified FROM integration_connections c WHERE id='shop'`).first<{verified:number}>())?.verified);
  const connection=()=>database.prepare("SELECT data_promotion_status status,last_error_code error,sync_lease_owner owner FROM integration_connections WHERE id='shop'").first<{status:string;error:string|null;owner:string|null}>();
  const approve=()=>database.prepare("UPDATE integration_connections SET data_promotion_status='approved',promotion_authorized_at=NULL,last_error_code=NULL,sync_lease_owner=NULL,sync_lease_expires_at=NULL WHERE id='shop'").run();
  await t.test("tax, cost, units and replay match independently expected totals",async()=>{
    assert.equal((await sync()).status,200); assert.equal(await verified(),true); assert.equal((await authority()).status,"ready"); assert.deepEqual(await metrics(),[{net:10000,cost:6000,units:5,transactions:1}]);
    assert.equal((await sync()).status,200); assert.equal(await verified(),true); assert.equal((await authority()).status,"ready"); assert.deepEqual(await metrics(),[{net:10000,cost:6000,units:5,transactions:1}]);
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM integration_staged_sales WHERE connection_id='shop'").first<{count:number}>())?.count,1);
  });
  await t.test("removed line and cancellation replace earlier source snapshots",async()=>{
    const corrected=order({updatedAt:"2026-10-08T13:00:00Z",currentTotalPriceSet:money("63"),currentTotalTaxSet:money("3")}); corrected.lineItems.nodes[1].currentQuantity=0;state.orders=[corrected];
    await sync();assert.deepEqual(await metrics(),[{net:6000,cost:3600,units:3,transactions:1}]);
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM commerce_sale_lines WHERE connection_id='shop'").first<{count:number}>())?.count,1);
    state.orders=[order({updatedAt:"2026-10-08T14:00:00Z",cancelledAt:"2026-10-08T14:00:00Z"})];await sync();assert.deepEqual(await metrics(),[]);assert.equal(await verified(),true);assert.equal((await authority()).status,"needs_data");assert.deepEqual((await authority()).authoritativeConnectionIds,[]);
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM commerce_sale_lines WHERE connection_id='shop'").first<{count:number}>())?.count,0);
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM integration_staged_sales WHERE connection_id='shop'").first<{count:number}>())?.count,3,"History is retained");
  });
  await t.test("a publication failure rolls back deletion and keeps the source staged",async()=>{
    state.orders=[order({updatedAt:"2026-10-08T15:00:00Z"})];await sync();const prior=await metrics();
    await database.prepare("CREATE TRIGGER fixture_reject_metric BEFORE INSERT ON daily_business_metrics WHEN NEW.source_connection_id='shop' BEGIN SELECT RAISE(ABORT,'fixture publication failure'); END").run();
    state.orders=[order({updatedAt:"2026-10-08T16:00:00Z"})];await assert.rejects(sync,/fixture publication failure/);assert.deepEqual(await metrics(),prior);assert.equal((await connection())?.status,"staging");
    await database.prepare("DROP TRIGGER fixture_reject_metric").run();await approve();await sync();assert.deepEqual(await metrics(),prior);
  });
  await t.test("currency failure cannot publish and preserves another tenant",async()=>{
    await database.prepare("INSERT INTO daily_business_metrics(organization_id,business_date,location_ref,gross_sales_cents,net_sales_cents,cost_of_goods_cents,transaction_count,units_sold,created_by_user_id,created_at,updated_at) VALUES ('other-org','2026-10-08','other',777,777,1,1,7,'fixture-owner',1,1)").run();
    const prior=await metrics();state.currency="USD";await assert.rejects(sync,/currency/i);assert.deepEqual(await metrics(),prior);assert.equal((await connection())?.status,"staging");
    assert.equal((await database.prepare("SELECT net_sales_cents net FROM daily_business_metrics WHERE organization_id='other-org'").first<{net:number}>())?.net,777);state.currency="CAD";
  });
  await t.test("incomplete pages do not publish but preserve resumable authorization",async()=>{
    await approve();state.orderMore=true;const prior=await metrics();await sync();assert.deepEqual(await metrics(),prior);assert.equal((await connection())?.status,"staging");
    state.orderMore=false;await sync();assert.equal((await connection())?.status,"approved");
  });
  await t.test("publication guard catches a lease replacement after the last heartbeat",async()=>{
    await approve(); const prior=await metrics();
    fixture.beforeBatch(items=>{
      if(!items.some(item=>item.sql.includes("DELETE FROM daily_business_metrics"))) return;
      fixture.beforeBatch(undefined);
      fixture.sqlite.prepare("UPDATE integration_connections SET sync_version=sync_version+1,sync_lease_owner='new-owner',sync_lease_expires_at=?,data_promotion_status='approved',last_error_code=NULL WHERE id='shop'").run(Math.floor(Date.now()/1000)+600);
    });
    await assert.rejects(sync,/constraint/i);assert.deepEqual(await metrics(),prior);
    assert.deepEqual(await connection(),{status:"approved",error:null,owner:"new-owner"});assert.equal(await verified(),false);
    await approve();
  });
  await t.test("lost lease cannot publish or demote a replacement generation",async()=>{
    state.steal=true;const prior=await metrics();await assert.rejects(sync,/superseded/i);assert.deepEqual(await metrics(),prior);
    assert.deepEqual(await connection(),{status:"approved",error:null,owner:"new-owner"});assert.equal(await verified(),false);
  });
});
