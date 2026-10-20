import assert from "node:assert/strict";
import test from "node:test";
import { posSqliteFixture } from "./helpers/pos-sqlite-fixture.ts";
import { providerCoverageQueries, loadProviderCoverage } from "../server/provider-report-coverage.ts";

test("report presence lookups retain tenant, connection, period and location scope with bounded indexed reads",async()=>{
  const f=await posSqliteFixture();
  try {
    f.sqlite.exec(`INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES ('actor','coverage@example.invalid','Report coverage',1,1);
      INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at)
      VALUES ('org','Test','Coverage','Coverage','coverage@example.invalid','Retail','Edmonton','Test','T5A1A1','[]',1,1),
      ('other','Test','Other','Other','other@example.invalid','Retail','Edmonton','Test','T5A1A1','[]',1,1);`);
    const stmt=f.sqlite.prepare(`INSERT INTO daily_business_metrics(organization_id,business_date,location_ref,source_connection_id,gross_sales_cents,net_sales_cents,cost_of_goods_cents,transaction_count,units_sold,created_by_user_id,created_at,updated_at)
      VALUES (?,?,?, ?,100,100,40,1,1,'actor',1,1)`);
    for(let i=0;i<10000;i++)stmt.run('org',new Date(Date.UTC(2000,0,1+i)).toISOString().slice(0,10),'north','own');
    stmt.run('other','2026-10-11','north','own');
    stmt.run('org','2026-10-11','south','different');
    const input={organizationId:'org',connectionId:'own',metricRefs:['north'],outletRefs:['north'],locationIds:['north'],catalogDimensionsAllowed:false,start:'2026-10-01',end:'2026-10-11',timeZone:'America/Edmonton'};
    assert.equal((await loadProviderCoverage(f.database,input)).sales,true);
    assert.equal((await loadProviderCoverage(f.database,{...input,metricRefs:['south']})).sales,false);
    assert.equal((await loadProviderCoverage(f.database,{...input,connectionId:'different'})).sales,false);
    assert.equal((await loadProviderCoverage(f.database,{...input,start:'2028-01-01',end:'2028-01-02'})).sales,false);
    assert.equal((await loadProviderCoverage(f.database,{...input,organizationId:'missing'})).sales,false);
    assert.equal((await loadProviderCoverage(f.database,{...input,connectionId:"own' OR 1=1 --"})).sales,false);
    const result=await loadProviderCoverage(f.database,input);
    assert.equal(result.products,false);assert.equal(result.customers,false);assert.equal(result.suppliers,false);
    const queries=providerCoverageQueries({...input,metricRefs:Array.from({length:600},(_,i)=>`mapped-${i}`).concat('north')});
    for(const query of queries) {
      assert.ok(query.bindings.length<10,'Mapped locations must not exceed D1 parameter bounds');
      const plan=(await f.database.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).bind(...query.bindings).all<{detail:string}>()).results!;
      if(query.sql.includes('FROM daily_business_metrics')) {
        assert.ok(plan.some(row=>/SEARCH daily_business_metrics USING INDEX/.test(row.detail)),JSON.stringify(plan));
        assert.equal(plan.some(row=>/^SCAN daily_business_metrics\b/.test(row.detail)),false);
      }
    }
  }finally{f.close();}
});
