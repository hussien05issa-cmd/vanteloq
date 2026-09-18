import assert from "node:assert/strict";
import test from "node:test";
import { createEnvironment, createReportWorkspace, seedReportConnection, seedReportMetric, dispatch } from "./helpers/retail-worker-fixture.mjs";

test("executive profit is withheld for ambiguous R-Series return costs without changing sales", { timeout: 120000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const a = await createReportWorkspace(worker, environment, database, "cost-evidence");
    const connectionId = "cost-" + crypto.randomUUID(), namespace = "cost-fixture", externalLocationRef = "1";
    const locationRef = await seedReportConnection(database, { ...a, connectionId, namespace, externalLocationRef });
    for (const [date, net, cost] of [["2026-08-23", 5999, 2799], ["2026-08-25", -5999, 0]]) {
      await seedReportMetric(database, { ...a, businessDate: date, locationRef, netSalesCents: Math.max(0, net), sourceConnectionId: connectionId });
      await database.prepare("UPDATE daily_business_metrics SET net_sales_cents=?,refunds_cents=?,cost_of_goods_cents=?,updated_at=? WHERE organization_id=? AND business_date=?")
        .bind(net, Math.max(0, -net), cost, Date.now(), a.organizationId, date).run();
    }
    const stagedId = crypto.randomUUID();
    await database.prepare("INSERT INTO integration_sync_runs(id,organization_id,provider,connection_id,mode,status,started_at,completed_at) VALUES ('fixture',?,'lightspeed-r',?,'incremental','completed',?,?)")
      .bind(a.organizationId, connectionId, Math.floor(Date.now()/1000), Math.floor(Date.now()/1000)).run();
    await database.prepare("INSERT INTO integration_staged_sales(id,organization_id,provider,connection_id,external_sale_id,external_version,outlet_ref,sold_at,state,total_cents,tax_cents,cost_cents,discount_cents,line_count,source_payload_hash,sync_run_id,staged_at) VALUES (?,?,'lightspeed-r',?,'return-1','1',?,'2026-08-25T12:00:00-06:00','completed',-5999,0,0,0,1,'fixture','fixture',?)")
      .bind(stagedId, a.organizationId, connectionId, namespace + ":1", Date.now()).run();
    const load = async (from="2026-08-23",to="2026-08-25") => {
      const response = await dispatch(worker, environment, "/api/v1/command-centre?executive=1&period=custom&from=" + from + "&to=" + to, a.owner);
      assert.equal(response.status, 200, await response.clone().text());
      const body = await response.json();
      return body.executiveReport.metrics;
    };
    let metrics = await load();
    assert.equal(metrics.find(m => m.key === "net_revenue").value, 0);
    assert.equal(metrics.find(m => m.key === "gross_profit").value, null);
    assert.ok(Math.abs(Date.parse(metrics[0].sourceTimestamp) - Date.now()) < 30_000, "legacy timestamps show the real instant");
    metrics = await load("2026-08-23","2026-08-23");
    assert.equal(metrics.find(m => m.key === "gross_profit").value, 3200, "missing costs outside the period do not hide known profit");
    await seedReportMetric(database, { ...a, businessDate: "2026-08-26", locationRef, netSalesCents: 10000, sourceConnectionId: connectionId });
    await database.prepare("UPDATE daily_business_metrics SET cost_of_goods_cents=4000 WHERE organization_id=? AND business_date='2026-08-26'").bind(a.organizationId).run();
    metrics = await load("2026-08-26", "2026-08-26");
    assert.equal(metrics.find(m => m.key === "gross_profit").value, 6000, "an unknown previous period must not hide current verified profit");
    assert.equal(metrics.find(m => m.key === "gross_profit").previous, null);
    await database.prepare("UPDATE integration_staged_sales SET cost_cents=-2799 WHERE id=?").bind(stagedId).run();
    await database.prepare("UPDATE daily_business_metrics SET cost_of_goods_cents=-2799 WHERE organization_id=? AND business_date='2026-08-25'").bind(a.organizationId).run();
    metrics = await load();
    assert.equal(metrics.find(m => m.key === "net_revenue").value, 0);
    assert.equal(metrics.find(m => m.key === "gross_profit").value, 0);
  } finally { await dispose(); }
});
