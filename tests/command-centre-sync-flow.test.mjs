import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/v1/command-centre/route.ts";
import { createEnvironment, createReportWorkspace, seedReportConnection, seedReportLocation, seedReportMetric, identityHeaders, origin } from "./helpers/retail-worker-fixture.mjs";

test("command-centre sync states follow authorized locations without reporting partial executive totals", { timeout: 120000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  const oldEnv = globalThis.__vanteloqEnv;
  try {
    const a = await createReportWorkspace(worker, environment, database, "sync-presentation");
    const b = await createReportWorkspace(worker, environment, database, "sync-isolation");
    const secondLocationId = await seedReportLocation(database, a.organizationId, "Second location");
    const firstConnection = "sync-first-" + crypto.randomUUID(), secondConnection = "sync-second-" + crypto.randomUUID();
    const firstRef = await seedReportConnection(database, { ...a, connectionId: firstConnection, namespace: "first", externalLocationRef: "1" });
    const secondRef = await seedReportConnection(database, { ...a, locationId: secondLocationId, connectionId: secondConnection, namespace: "second", externalLocationRef: "2" });
    await seedReportMetric(database, { ...a, businessDate: "2026-08-23", locationRef: firstRef, netSalesCents: 12345, sourceConnectionId: firstConnection });
    await seedReportMetric(database, { ...a, businessDate: "2026-08-23", locationRef: secondRef, netSalesCents: 45678, sourceConnectionId: secondConnection });
    globalThis.__vanteloqEnv = environment;
    const load = (identity = a, query = "") => GET(new Request(origin + "/api/v1/command-centre" + query, { headers: identityHeaders(identity.owner.email, identity.owner.name) }));
    const source = async (identity = a, query = "") => {
      const response = await load(identity, query);
      assert.equal(response.status, 200, await response.clone().text());
      return (await response.json()).commandCentre.source;
    };
    assert.equal((await source()).syncing, false);
    const expires = Math.floor(Date.now() / 1000) + 300;
    await database.prepare("UPDATE integration_connections SET sync_lease_owner='fixture-sync',sync_lease_expires_at=? WHERE id=?").bind(expires, firstConnection).run();
    assert.equal((await source()).syncing, true);
    assert.equal((await source(a, "?location=" + a.locationId)).syncing, true);
    assert.equal((await source(a, "?location=" + secondLocationId)).syncing, false);
    assert.equal((await source(b)).syncing, false, "another tenant's refresh is not exposed");
    const period = "?executive=1&period=custom&from=2026-08-23&to=2026-08-23";
    const blocked = await load(a, period);
    assert.equal(blocked.status, 503);
    const blockedBody = await blocked.json();
    assert.equal(blockedBody.error.code, "SOURCE_SYNCING");
    assert.match(blockedBody.error.message, /Syncing source records/);
    assert.equal(blockedBody.executiveReport, undefined);
    const unaffected = await load(a, period + "&location=" + secondLocationId);
    assert.equal(unaffected.status, 200, await unaffected.clone().text());
    assert.equal((await unaffected.json()).executiveReport.metrics.find(metric => metric.key === "net_revenue").value, 45678);

    await database.prepare("UPDATE integration_connections SET data_promotion_status='staging',promotion_authorized_at=? WHERE id=?").bind(Math.floor(Date.now() / 1000), firstConnection).run();
    assert.equal((await source(a, "?location=" + a.locationId)).syncing, true, "temporary publication gating does not hide the sync label");
    await database.prepare("UPDATE integration_connections SET promotion_authorized_at=NULL WHERE id=?").bind(firstConnection).run();
    assert.equal((await source(a, "?location=" + a.locationId)).syncing, false, "an excluded source is not called an authorized refresh");
    await database.prepare("UPDATE integration_connections SET promotion_authorized_at=1,sync_lease_expires_at=1 WHERE id=?").bind(firstConnection).run();
    assert.equal((await source(a, "?location=" + a.locationId)).syncing, false, "expired leases are not called active syncs");
    await database.prepare("UPDATE integration_connections SET sync_lease_expires_at=?,status='revoked' WHERE id=?").bind(expires, firstConnection).run();
    assert.equal((await source(a, "?location=" + a.locationId)).syncing, false, "revoked sources cannot appear to be syncing");
    await database.prepare("UPDATE integration_connections SET status='connected',data_promotion_status='approved',promotion_authorized_at=NULL,sync_lease_owner=NULL,sync_lease_expires_at=NULL WHERE id=?").bind(firstConnection).run();
    assert.equal((await source()).syncing, false);
    const restored = await load(a, period);
    assert.equal(restored.status, 200, await restored.clone().text());
    assert.equal((await restored.json()).executiveReport.metrics.find(metric => metric.key === "net_revenue").value, 58023);
    await database.prepare("UPDATE memberships SET status='suspended' WHERE organization_id=? AND user_id=?").bind(a.organizationId, a.userId).run();
    assert.equal((await load()).status, 403);
  } finally { globalThis.__vanteloqEnv = oldEnv; await dispose(); }
});
