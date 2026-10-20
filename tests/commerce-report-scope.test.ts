import assert from "node:assert/strict";
import test from "node:test";
import { posSqliteFixture } from "./helpers/pos-sqlite-fixture.ts";
import { GET } from "../app/api/v1/commerce-intelligence/route.ts";
import type { VanteloqRuntimeEnv } from "../db/index.ts";

/** Real authenticated route, migrated SQLite and fictional identity transport. */
async function fixture() {
  const f=await posSqliteFixture(),db=f.database,oldFetch=globalThis.fetch;
  const runtime=globalThis as typeof globalThis & {__vanteloqEnv?:VanteloqRuntimeEnv},oldEnv=runtime.__vanteloqEnv;
  runtime.__vanteloqEnv={DB:db,SUPABASE_URL:"https://commerce-identity.example.invalid",SUPABASE_PUBLISHABLE_KEY:"fictional"};
  globalThis.fetch=async(input,init)=>{
    const request=new Request(input,init),url=new URL(request.url);
    assert.equal(url.origin,"https://commerce-identity.example.invalid","No real identity or connector traffic is permitted");
    if(url.pathname==="/rest/v1/team_access_invitations")return Response.json([]);
    assert.equal(url.pathname,"/auth/v1/user");
    const payload=JSON.parse(Buffer.from(request.headers.get('authorization')!.split('.')[1],'base64url').toString());
    return Response.json({id:payload.sub,email:payload.sub+'@example.invalid',email_confirmed_at:"2026-01-01",user_metadata:{}});
  };
  for(const user of ['owner','limited'])await db.prepare("INSERT INTO users(id,email,auth_subject,auth_provider,display_name,created_at,updated_at) VALUES(?,?,?,'supabase',?,1,1)").bind(user,user+'@example.invalid',user,user).run();
  for(const org of ['org','other']) {
    await db.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,timezone,currency,created_at,updated_at) VALUES(?,'QA','QA','QA','qa@example.invalid','Retail','Edmonton','Test','T5A1A1','[]','America/Edmonton','CAD',1,1)").bind(org).run();
    await db.prepare("INSERT INTO tenant_subscriptions(organization_id,base_plan,billing_interval,status,created_at,updated_at) VALUES(?,'pro','month','active',1,1)").bind(org).run();
  }
  for(const [user,role]of [['owner','owner'],['limited','admin']])await db.prepare("INSERT INTO memberships(id,user_id,organization_id,role,status,created_at,updated_at) VALUES(?,?,'org',?,'active',1,1)").bind(user,user,role).run();
  for(const [location,org]of [['main','org'],['private','org'],['foreign','other']])await db.prepare("INSERT INTO organization_locations(id,organization_id,name,country_code,address_line_1,locality,administrative_area,timezone,currency,created_at,updated_at) VALUES(?,?,?,'CA','Test','Edmonton','AB','America/Edmonton','CAD',1,1)").bind(location,org,location).run();
  const permissions=['dashboard.view','metrics.revenue','sales.transactions','metrics.profit','finance.costs','inventory.view','inventory.value','purchasing.view','customers.totals'];
  await db.prepare("INSERT INTO access_roles(id,organization_id,name,permissions_json,location_scope_json,created_by_user_id,created_at,updated_at) VALUES('reader','org','Reader',?,'[\"main\"]','owner',1,1)").bind(JSON.stringify(permissions)).run();
  await db.prepare("INSERT INTO team_members(id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at) VALUES('limited-member','org','limited','reader','Read','Only','limited@example.invalid','L','[\"main\"]','active',1,'owner',1,1)").run();
  const now=Math.floor(Date.now()/1000);
  for(const [id,org,provider,location]of [['a','org','square','main'],['b','org','clover','main'],['private-source','org','square','private'],['foreign-source','other','square','foreign']]) {
    await db.prepare("INSERT INTO integration_connections(id,organization_id,provider,source_namespace,status,external_account_name,data_promotion_status,last_successful_sync_at,created_at,updated_at) VALUES(?,?,?,?,'connected',?,'approved',?,?,?)").bind(id,org,provider,id,'Fictional '+id,now,now,now).run();
    await db.prepare("INSERT INTO integration_location_mappings(id,organization_id,provider,connection_id,external_location_ref,external_name,local_location_id,status,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,'outlet','Fictional',?,'mapped',?,?,?)").bind('map-'+id,org,provider,id,location,now,now,now).run();
    await db.prepare("INSERT INTO integration_sync_runs(id,organization_id,provider,connection_id,mode,status,started_at,completed_at) VALUES(?,?,?,?,'incremental','completed',?,?)").bind('run-'+id,org,provider,id,now,now).run();
    await db.prepare("INSERT INTO commerce_products(id,organization_id,provider,connection_id,external_product_id,sku,name,supplier_ref,default_cost_cents,source_payload_hash,sync_run_id,updated_at) VALUES(?,?,?,?,'product','SKU',?,'supplier',9999,'fictional',?,?)").bind('product-'+id,org,provider,id,'Product '+id,'run-'+id,now).run();
    await db.prepare("INSERT INTO commerce_customers(id,organization_id,provider,connection_id,external_customer_id,display_name,source_payload_hash,sync_run_id,updated_at) VALUES(?,?,?,?,'customer',?,'fictional',?,?)").bind('customer-'+id,org,provider,id,'Customer '+id,'run-'+id,now).run();
    await db.prepare("INSERT INTO commerce_suppliers(id,organization_id,provider,connection_id,external_supplier_id,name,source_payload_hash,sync_run_id,updated_at) VALUES(?,?,?,?,'supplier',?,'fictional',?,?)").bind('supplier-'+id,org,provider,id,'Supplier '+id,'run-'+id,now).run();
    await db.prepare("INSERT INTO inventory_balances(id,organization_id,source_provider,source_connection_id,location_ref,sku,name,on_hand_quantity,reorder_point,updated_at) VALUES(?,?,?,?,?,'SKU',?,3,5,?)").bind('stock-'+id,org,provider,id,provider+':'+id+':outlet','Product '+id,now).run();
    await db.prepare("INSERT INTO commerce_sale_lines(id,organization_id,provider,connection_id,external_sale_id,external_line_id,product_ref,customer_ref,outlet_ref,sold_at,sku,product_name,quantity_milli,net_sales_cents,cost_cents,cost_known,source_payload_hash,sync_run_id,updated_at) VALUES(?,?,?,?,?,'1','product','customer',?,'2026-09-15T18:00:00Z','SKU',?,1000,?,0,1,'fictional',?,?)").bind('line-'+id,org,provider,id,'sale-'+id,id+':outlet','Product '+id,id==='a'?1000:999999,'run-'+id,now).run();
  }
  const request=(query='',user='owner')=>{
    const payload=Buffer.from(JSON.stringify({sub:user,aal:'aal2',session_id:'commerce-'+user})).toString('base64url');
    const params=new URLSearchParams({mode:'Sales',from:'2026-09-15',to:'2026-09-15'});
    for(const [key,value]of new URLSearchParams(query))params.set(key,value);
    return GET(new Request('https://vanteloq.example/api/v1/commerce-intelligence?'+params,{headers:{authorization:'Bearer test.'+payload+'.signature'}}));
  };
  const json=async(query='',user='owner')=>{const r=await request(query,user);assert.equal(r.status,200,await r.clone().text());return r.json();};
  return {...f,db,request,json,dispose(){globalThis.fetch=oldFetch;runtime.__vanteloqEnv=oldEnv;f.close();}};
}

test('source product reports keep exact account, period, location and known-zero margins',async()=>{
  const f=await fixture();try{
    const result=await f.json('connection=a&location=main');
    assert.equal(result.kpis.netSalesCents,1000);assert.equal(result.kpis.costCents,0);assert.equal(result.kpis.grossProfitCents,1000);
    assert.equal(result.products.length,1);assert.equal(result.products[0].grossProfitCents,1000);
    assert.equal(result.saleLines[0].costCents,0);assert.equal(result.sourceScope.connectionId,'a');
    assert.equal(result.sourceScope.provider,'square');assert.equal(result.sourceScope.locationId,'main');
    assert.equal(result.sourceScope.from,'2026-09-15');assert.equal(result.sourceScope.timeZone,'America/Edmonton');
    assert.equal(result.readiness.ready,false);assert.equal(result.readiness.certification,'not_certified');
    assert.doesNotMatch(JSON.stringify(result),/999999|Customer b|Product b|foreign-source|private-source/);
  }finally{f.dispose();}
});

test('partial nonzero sale costs do not certify aggregate product, customer or supplier margins',async()=>{
  const f=await fixture();try{
    f.sqlite.exec(`UPDATE commerce_sale_lines SET cost_cents=300 WHERE id='line-a';
      INSERT INTO commerce_sale_lines(id,organization_id,provider,connection_id,external_sale_id,external_line_id,product_ref,customer_ref,outlet_ref,sold_at,sku,product_name,quantity_milli,net_sales_cents,cost_cents,cost_known,source_payload_hash,sync_run_id,updated_at)
      SELECT 'missing',organization_id,provider,connection_id,external_sale_id,'2',product_ref,customer_ref,outlet_ref,sold_at,sku,product_name,1000,100,0,0,source_payload_hash,sync_run_id,updated_at FROM commerce_sale_lines WHERE id='line-a'`);
    for(const mode of ['Sales','Inventory','Customers','Suppliers']) {
      const result=await f.json('connection=a&location=main&mode='+mode);
      assert.equal(result.kpis.netSalesCents,1100);assert.equal(result.kpis.costCents,null);assert.equal(result.kpis.grossProfitCents,null);
      if(mode==='Sales')assert.equal(result.products[0].grossProfitCents,null);
      if(mode==='Inventory')assert.equal(result.inventory[0].periodCostCents,null);
      if(mode==='Customers') {assert.equal(result.customers.length,1);assert.equal(result.customers[0].costCents,null);assert.equal(result.customers[0].grossProfitCents,null);}
      if(mode==='Suppliers') {assert.equal(result.suppliers.length,1);assert.equal(result.suppliers[0].periodCostCents,null);assert.equal(result.suppliers[0].periodGrossProfitCents,null);}
    }
  }finally{f.dispose();}
});

test('provider reports reject foreign, unmapped and unauthorized source identities',async()=>{
  const f=await fixture();try{
    for(const query of ['connection=foreign-source','connection=missing','connection=a&location=private',"connection=a%27%20OR%201%3D1--"])assert.equal((await f.request(query)).status,403,query);
    assert.equal((await f.request('connection=a','limited')).status,403);
    assert.equal((await f.request()).status,409,'consolidated sources still require authority');
    f.sqlite.exec("UPDATE integration_connections SET data_promotion_status='staging' WHERE id='a'");
    assert.equal((await f.request('connection=a')).status,403);
  }finally{f.dispose();}
});
