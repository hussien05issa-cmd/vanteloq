import assert from "node:assert/strict";
import test from "node:test";
import { GET as dashboard } from "../app/api/v1/command-centre/route.ts";
import { GET as reports } from "../app/api/v1/reports/route.ts";
import { createEnvironment, createReportWorkspace, seedReportConnection, seedReportLocation, seedReportMetric, identityHeaders, origin } from "./helpers/retail-worker-fixture.mjs";

test("revenue attribution and its source report share dates, locations, authority and tenant boundaries", { timeout: 120000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  const oldEnv = globalThis.__vanteloqEnv;
  try {
    const a = await createReportWorkspace(worker, environment, database, "revenue-attribution");
    const b = await createReportWorkspace(worker, environment, database, "private-revenue");
    const second = await seedReportLocation(database, a.organizationId, "Second location");
    const manual = await seedReportLocation(database, a.organizationId, "Manual location");
    const payment = await seedReportLocation(database, a.organizationId, "Payments location");
    const source = async (identity, provider, locationId, amounts) => {
      const connectionId = provider + crypto.randomUUID(), namespace = "production:" + crypto.randomUUID();
      const rRef = await seedReportConnection(database, {...identity,locationId,connectionId,namespace,externalLocationRef:"1"});
      const locationRef = rRef.replace(/^lightspeed-r:/,provider+":");
      await database.prepare("UPDATE integration_connections SET provider=? WHERE id=?").bind(provider,connectionId).run();
      await database.prepare("UPDATE integration_location_mappings SET provider=? WHERE connection_id=?").bind(provider,connectionId).run();
      for (const [businessDate,netSalesCents] of amounts) {
        await seedReportMetric(database,{...identity,businessDate,locationRef,netSalesCents:Math.max(0,netSalesCents),sourceConnectionId:connectionId});
        await database.prepare("UPDATE daily_business_metrics SET source_provider=?,net_sales_cents=?,refunds_cents=?,updated_at=? WHERE organization_id=? AND business_date=? AND location_ref=?")
          .bind(provider,netSalesCents,netSalesCents<0?-netSalesCents:0,Date.parse("2026-08-24T12:00:00Z")/1000,identity.organizationId,businessDate,locationRef).run();
      }
      return connectionId;
    };
    const square = await source(a,"square",a.locationId,[["2026-08-23",10000],["2026-08-24",-2000],["2026-08-22",99000]]);
    await source(a,"shopify",a.locationId,[["2026-08-23",3000],["2026-08-24",4000]]);
    await source(a,"lightspeed-r",second,[["2026-08-23",70000]]);
    await source(a,"moneris",payment,[["2026-08-23",99999]]);
    await source(b,"square",b.locationId,[["2026-08-23",88888]]);
    await seedReportMetric(database,{...a,businessDate:"2026-08-23",locationRef:a.locationId,netSalesCents:999999});
    await seedReportMetric(database,{...a,businessDate:"2026-08-23",locationRef:manual,netSalesCents:900});
    globalThis.__vanteloqEnv = environment;
    const params = "?executive=1&period=custom&from=2026-08-23&to=2026-08-24";
    const load = (identity = a, query = params) => dashboard(new Request(origin+"/api/v1/command-centre"+query,{headers:identityHeaders(identity.owner.email,identity.owner.name)}));
    const read = async (identity = a, query = params) => {
      const response = await load(identity,query);
      assert.equal(response.status,200,await response.clone().text());
      return (await response.json()).executiveReport;
    };
    const all = await read();
    assert.equal(all.metrics.find(row=>row.key==="net_revenue").value,85900);
    assert.equal(all.revenueSources.totalCents,85900);
    assert.deepEqual(all.revenueSources.sources.map(row=>[row.label,row.cents]), [["Lightspeed Retail R-Series",70000],["Square",8000],["Shopify",7000],["Reviewed entries",900]]);
    assert.equal(all.metrics.find(row=>row.key==="net_revenue").change,null,"incomplete comparison cannot invent a growth percentage");
    const scoped = await read(a,params+"&location="+a.locationId);
    assert.equal(scoped.revenueSources.totalCents,15000);
    const sameReport = await reports(new Request(origin+"/api/v1/reports?report=sales_totals&start=2026-08-23&end=2026-08-24&location="+a.locationId,{headers:identityHeaders(a.owner.email,a.owner.name)}));
    assert.equal(sameReport.status,200,await sameReport.clone().text());
    const report = await sameReport.json();
    assert.equal(report.rows.reduce((sum,row)=>sum+row.netSalesCents,0),scoped.revenueSources.totalCents);
    assert.equal((await read(a,params.replace("to=2026-08-24","to=2026-08-23")+"&location="+a.locationId)).revenueSources.totalCents,13000);
    assert.equal((await read(b)).revenueSources.totalCents,88888);
    assert.equal((await load(b,params+"&location="+a.locationId)).status,403);
    assert.equal((await dashboard(new Request(origin+"/api/v1/command-centre"+params))).status,401);

    // A second retail feed is an overlap, not another stream of revenue.
    await source(a,"clover",a.locationId,[["2026-08-23",50000]]);
    assert.equal((await load()).status,409);
    const conflicted = await load(a, "");
    assert.equal((await conflicted.json()).commandCentre.ready,false,"the default dashboard also withholds partial totals");
    const timestamp = Math.floor(Date.now()/1000);
    await database.prepare("INSERT INTO integration_source_authorities (id,organization_id,local_location_id,channel,fact_family,provider,connection_id,created_by_user_id,updated_by_user_id,version,created_at,updated_at) VALUES (?, ?, ?, 'retail', 'sales', 'square', ?, ?, ?, 1, ?, ?)")
      .bind(crypto.randomUUID(),a.organizationId,a.locationId,square,a.userId,a.userId,timestamp,timestamp).run();
    assert.equal((await read()).revenueSources.totalCents,85900,"owner source selection excludes the duplicate");
    await database.prepare("UPDATE memberships SET status='suspended' WHERE organization_id=? AND user_id=?").bind(a.organizationId,a.userId).run();
    assert.equal((await load()).status,403);
  } finally { globalThis.__vanteloqEnv = oldEnv; await dispose(); }
});