import assert from "node:assert/strict";
import test from "node:test";
import { createEnvironment, createReportWorkspace, seedReportConnection, seedReportLocation, seedSalesAuthority, dispatch } from "./helpers/retail-worker-fixture.mjs";

test("retail Worker enforces tenant/location/privacy boundaries, source approval, evidence CRUD and AI consent", async () => {
  const { worker, environment, database: db, dispose } = await createEnvironment();
  const originalFetch = globalThis.fetch;
  try {
    const owner = await createReportWorkspace(worker, environment, db, "retail"), other = await createReportWorkspace(worker, environment, db, "other-retail");
    const privateLocation = await seedReportLocation(db, owner.organizationId, "Private outlet"), now = Math.floor(Date.now() / 1000);
    const seed = async (identity, connectionId, locationId, promotionStatus, name, amount) => {
      await seedReportConnection(db, { ...identity, locationId, connectionId, namespace: "legacy", externalLocationRef: "shop", promotionStatus });
      const run = "run-" + connectionId;
      await db.prepare("INSERT INTO integration_sync_runs (id,organization_id,provider,connection_id,mode,status,started_at,completed_at) VALUES (?,?,'lightspeed-r',?,'incremental','completed',?,?)").bind(run, identity.organizationId, connectionId, now, now).run();
      await db.prepare("INSERT INTO commerce_products (id,organization_id,provider,connection_id,external_product_id,sku,name,category_ref,default_cost_cents,source_payload_hash,sync_run_id,updated_at) VALUES (?,?,'lightspeed-r',?,'product','SKU',?,'category-id',400,'hash',?,?)").bind("product-" + connectionId, identity.organizationId, connectionId, name, run, now).run();
      await db.prepare("INSERT INTO commerce_customers (id,organization_id,provider,connection_id,external_customer_id,display_name,email,source_payload_hash,sync_run_id,updated_at) VALUES (?,?,'lightspeed-r',?,'customer-secret','Private customer','private@example.invalid','hash',?,?)").bind("customer-" + connectionId, identity.organizationId, connectionId, run, now).run();
      for (const date of ["2026-09-10", "2026-09-11"]) {
        await db.prepare("INSERT INTO integration_staged_sales (id,organization_id,provider,connection_id,external_sale_id,external_version,outlet_ref,sold_at,state,total_cents,line_count,source_payload_hash,sync_run_id,staged_at) VALUES (?,?,'lightspeed-r',?,?, '1','shop',?,'completed',?,1,'hash',?,?)")
          .bind('parent-'+connectionId+date,identity.organizationId,connectionId,date,date+'T11:00:00',amount,run,now).run();
        await db.prepare("INSERT INTO commerce_sale_lines (id,organization_id,provider,connection_id,external_sale_id,external_line_id,product_ref,customer_ref,outlet_ref,sold_at,sku,product_name,quantity_milli,net_sales_cents,cost_cents,discount_cents,source_payload_hash,sync_run_id,updated_at) VALUES (?,?,'lightspeed-r',?,?,'1','product','customer-secret','shop',?,'SKU',?,1000,?,400,0,'hash',?,?)")
          .bind(connectionId + date, identity.organizationId, connectionId, date, date + "T11:00:00", name, amount, run, now).run();
      }
      await db.prepare("INSERT INTO inventory_balances (id,organization_id,location_ref,sku,name,on_hand_quantity,reorder_point,source_provider,source_connection_id,updated_at,version) VALUES (?,?,'lightspeed-r:shop','SKU',?,20,3,'lightspeed-r',?,?,1)")
        .bind(crypto.randomUUID(), identity.organizationId, name, connectionId, now).run();
    };
    // The table permits one balance per organization/location/SKU, so only the primary
    // source receives a balance; other scopes below use distinct namespace/outlet data.
    await seed(owner, "real-retail", owner.locationId, "approved", "Whey protein", 1000);
    await seedReportConnection(db, { ...owner, locationId: privateLocation, connectionId: "private-retail", namespace: "private", externalLocationRef: "shop", promotionStatus: "approved" });
    await seedReportConnection(db, { ...owner, connectionId: "test-retail", namespace: "test", externalLocationRef: "shop", promotionStatus: "staging" });
    for (const [connection, namespace] of [["private-retail", "private"], ["test-retail", "test"]]) {
      const run = crypto.randomUUID();
      await db.prepare("INSERT INTO integration_sync_runs (id,organization_id,provider,connection_id,mode,status,started_at,completed_at) VALUES (?,?,'lightspeed-r',?,'incremental','completed',?,?)").bind(run, owner.organizationId, connection, now, now).run();
      await db.prepare("INSERT INTO commerce_sale_lines (id,organization_id,provider,connection_id,external_sale_id,external_line_id,outlet_ref,sold_at,product_name,quantity_milli,net_sales_cents,cost_cents,source_payload_hash,sync_run_id,updated_at) VALUES (?,?,'lightspeed-r',?,'hidden','hidden',?,'2026-09-11T11:00:00','PRIVATE TEST SECRET',1000,999999,100,'fixture',?,?)").bind(crypto.randomUUID(), owner.organizationId, connection, namespace + ':shop', run, now).run();
    }
    await seed(other, "other-retail", other.locationId, "approved", "OTHER TENANT SECRET", 99999);
    const query = "/api/v1/retail-intelligence?from=2026-09-11&to=2026-09-11&location=" + owner.locationId;
    const load = () => dispatch(worker, environment, query, owner.owner);
    assert.equal((await load()).status, 409, "a source choice is required when staged facts overlap");
    await seedSalesAuthority(db, { ...owner, connectionId: "real-retail" });
    // Creation time is not completion time. Open, voided and orphaned lines
    // must never enter trading totals, even when a previous parent was completed.
    await db.prepare("UPDATE commerce_sale_lines SET sold_at='2026-08-01T11:00:00' WHERE connection_id='real-retail'").run();
    for (const state of ['open','voided','orphan']) {
      await db.prepare("INSERT INTO commerce_sale_lines (id,organization_id,provider,connection_id,external_sale_id,external_line_id,outlet_ref,sold_at,quantity_milli,net_sales_cents,cost_cents,source_payload_hash,sync_run_id,updated_at) VALUES (?,?,'lightspeed-r','real-retail',?,'1','shop','2026-09-11T11:00:00',99000,999999,100,'test','run-real-retail',?)").bind('excluded-'+state,owner.organizationId,state,now).run();
      if (state === 'orphan') continue;
      for (const [version,status] of [['1','completed'],['2',state]]) {
        await db.prepare("INSERT INTO integration_staged_sales (id,organization_id,provider,connection_id,external_sale_id,external_version,outlet_ref,sold_at,state,total_cents,line_count,source_payload_hash,sync_run_id,staged_at) VALUES (?,?,'lightspeed-r','real-retail',?,?,'shop','2026-09-11T11:00:00',?,999999,1,'test','run-real-retail',?)")
          .bind('parent-'+state+version,owner.organizationId,state,version,status,now+Number(version)).run();
      }
    }
    let response = await load(); assert.equal(response.status, 200, await response.clone().text());
    let body = await response.json(); assert.equal(body.report.current.netCents, 1000); assert.equal(body.report.products[0].name, "Whey protein");
    assert.equal(body.report.inventory[0].dailyVelocity, 1); assert.equal(body.report.current.grossProfitCents, 600);
    assert.equal(body.report.products[0].category, "Unclassified", "an opaque category reference is not a customer-facing category label");
    assert.doesNotMatch(JSON.stringify(body.report.categories), /category-id/);
    await db.prepare("UPDATE commerce_products SET category_name='Nutrition/Protein' WHERE connection_id='real-retail'").run();
    body = await (await load()).json();
    assert.equal(body.report.products[0].category, "Nutrition/Protein");
    assert.match(body.report.dataQualityWarnings.join(' '), /Historical discount correction/);
    await db.prepare("UPDATE integration_sync_runs SET cursor_after=? WHERE id='run-real-retail'").bind(JSON.stringify({ version: 5 })).run();
    body = await (await load()).json();
    assert.doesNotMatch(body.report.dataQualityWarnings.join(' '), /Historical discount correction/);
    assert.doesNotMatch(JSON.stringify(body), /OTHER TENANT|PRIVATE TEST SECRET|private@example|customer-secret|test-retail/);
    await db.prepare("UPDATE commerce_sale_lines SET sku=NULL,product_name='R-Series item product' WHERE connection_id='real-retail'").run();
    body = await (await load()).json();
    assert.equal(body.report.products[0].name, "Whey protein", "verified catalogue names enrich generic sale lines");
    assert.equal(body.report.products[0].sku, "SKU");
    await db.prepare("UPDATE commerce_products SET name='R-Series item product' WHERE connection_id='real-retail'").run();
    body = await (await load()).json();
    assert.equal(body.report.products[0].sku, null, "a fallback product reference is not a verified SKU");
    assert.match(body.report.dataQualityWarnings.join(' '), /full POS catalogue/);
    await db.prepare("UPDATE commerce_products SET name='Whey protein' WHERE connection_id='real-retail'").run();
    await db.prepare("UPDATE commerce_sale_lines SET cost_cents=0 WHERE connection_id='real-retail'").run();
    assert.equal((await (await load()).json()).report.current.grossProfitCents, null);
    const legacy = await dispatch(worker, environment, query.replace('retail-intelligence?', 'commerce-intelligence?mode=Sales&'), owner.owner);
    assert.equal(legacy.status, 200, await legacy.clone().text()); assert.equal((await legacy.json()).kpis.grossProfitCents, null);
    await db.prepare("UPDATE commerce_sale_lines SET cost_cents=400 WHERE connection_id='real-retail'").run();
    await db.prepare("UPDATE integration_connections SET sync_lease_owner='running',sync_lease_expires_at=? WHERE id='real-retail'").bind(Math.floor(Date.now()/1000)+120).run();
    assert.equal((await load()).status, 409);
    await db.prepare("UPDATE integration_connections SET sync_lease_owner=NULL,sync_lease_expires_at=NULL WHERE id='real-retail'").run();
    assert.equal((await dispatch(worker, environment, query, other.owner)).status, 403);
    const route = "/api/v1/retail-measurements";
    const input = { action: "save", kind: "stock", from: "2026-09-11", to: "2026-09-11", locationId: owner.locationId, provider: "lightspeed-r", connectionId: "real-retail", outletRef: "shop", source: "Reviewed stock ledger", reviewed: true, expectedVersion: null, csv: "reference,openingUnits,receivedUnits,openingValueCents,closingValueCents\nSKU,10,5,1000,600" };
    const write = (changes = {}, identity = owner.owner) => dispatch(worker, environment, route, { ...identity, method: "POST", body: { ...input, ...changes } });
    assert.equal((await write({ connectionId: "other-retail" })).status, 403);
    assert.equal((await write({ connectionId: "test-retail" })).status, 403);
    assert.equal((await write({ reviewed: false })).status, 400);
    response = await write(); assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await write()).status, 409, "stale edits must not replace a saved dataset");
    body = await (await load()).json(); assert.equal(body.report.inventory[0].turnover, .5); assert.equal(body.report.inventory[0].sellThrough, 1 / 15);
    const concurrent = await Promise.all([write({ expectedVersion: 1, source: "Review A" }), write({ expectedVersion: 1, source: "Review B" })]);
    assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
    const listing = await dispatch(worker, environment, route + "?kind=stock&location=" + owner.locationId, owner.owner);
    assert.equal(listing.status, 200, await listing.clone().text()); const listed = await listing.json(); assert.equal(listed.datasets[0].version, 2);
    const catalog = { kind: "catalog", outletRef: "", csv: "reference,category,itemType\nSKU,Protein,Powder", source: "Reviewed catalogue" };
    assert.equal((await write(catalog)).status, 200); body = await (await load()).json(); assert.equal(body.report.products[0].category, "Protein"); assert.equal(body.report.products[0].itemType, "Powder");
    // A restricted role receives neither payroll/costs nor customer aggregates.
    const staff = { email: "retail-staff@example.invalid", name: "Staff" }, staffId = crypto.randomUUID(), roleId = crypto.randomUUID();
    await db.batch([
      db.prepare("INSERT INTO users (id,email,display_name,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)").bind(staffId, staff.email, staff.name, now, now),
      db.prepare("INSERT INTO memberships (id,user_id,organization_id,role,status,created_at,updated_at) VALUES (?,?,?,'employee','active',?,?)").bind(crypto.randomUUID(), staffId, owner.organizationId, now, now),
      db.prepare(`INSERT INTO access_roles (id,organization_id,name,description,color,permissions_json,location_scope_json,archived,created_by_user_id,created_at,updated_at) VALUES (?,?,'Retail view','','#245fce',?,'[]',0,?,?,?)`).bind(roleId, owner.organizationId, JSON.stringify(["dashboard.view", "metrics.revenue", "insights.view"]), owner.userId, now, now),
      db.prepare("INSERT INTO team_members (id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,primary_location_id,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,'Retail','Staff',?,'RETAIL-STAFF',?,?,'active',1,?,?,?)").bind(crypto.randomUUID(), owner.organizationId, staffId, roleId, staff.email, owner.locationId, JSON.stringify([owner.locationId]), owner.userId, now, now),
    ]);
    response = await dispatch(worker, environment, query, staff); assert.equal(response.status, 200, await response.clone().text());
    body = await response.json(); assert.equal(body.report.current.grossProfitCents, null); assert.equal(body.report.customers, null); assert.equal(body.report.operations, null); assert.deepEqual(body.report.inventory, []);
    assert.equal((await write({}, staff)).status, 403);
    assert.equal((await dispatch(worker, environment, query.replace(owner.locationId, privateLocation), staff)).status, 403);
    const prompts = [];
    environment.OPENAI_API_KEY = "fixture-only";
    globalThis.fetch = async (request, init) => {
      if (String(request) === "https://api.openai.com/v1/responses") { prompts.push(JSON.parse(init.body).input); return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Fixture retail analysis" }] }] }), { headers: { "content-type": "application/json" } }); }
      return originalFetch(request, init);
    };
    const askBody = { question: "Explain the retail performance", provider: "openai", dataUseAccepted: true, noticeVersion: "vanteloq-ai-v7-unified", privacyPolicyVersion: "2026-09-10", memoryEnabled: true, from: "2026-09-11", to: "2026-09-11", locationId: owner.locationId };
    const ask = (changes = {}, identity = staff) => dispatch(worker, environment, "/api/v1/advisor/chat", { ...identity, method: "POST", body: { ...askBody, ...changes } });
    assert.equal((await ask({ dataUseAccepted: false })).status, 409); assert.equal(prompts.length, 0);
    response = await dispatch(worker, environment, "/api/v1/advisor/consent", { ...staff, method: "POST", body: { accepted: true, purpose: "analysis", noticeVersion: askBody.noticeVersion, privacyPolicyVersion: askBody.privacyPolicyVersion } });
    assert.equal(response.status, 200, await response.clone().text());
    response = await ask(); assert.equal(response.status, 200, await response.clone().text()); const chat = await response.json(); assert.ok(chat.conversationId);
    let evidence = JSON.parse(prompts[0].split("Evidence JSON: ")[1].split("\n\nConversation memory:")[0]);
    assert.equal(evidence.retail.current.netCents, 1000); assert.equal(evidence.retail.current.grossProfitCents, null); assert.equal(evidence.retail.customers, null); assert.equal(evidence.requestedRetailPeriod.from, "2026-09-11");
    assert.doesNotMatch(prompts[0], /customer-secret|private@example|OTHER TENANT|connectionId|sku|lineId|productRef/);
    await db.prepare("UPDATE integration_connections SET sync_lease_owner='running',sync_lease_expires_at=? WHERE id='real-retail'").bind(Math.floor(Date.now()/1000)+120).run();
    response = await ask({ memoryEnabled: false }); assert.equal(response.status, 200, await response.clone().text());
    evidence = JSON.parse(prompts.at(-1).split("Evidence JSON: ")[1].split("\n\nConversation memory:")[0]);
    assert.equal(evidence.retail.status, "unavailable");
    assert.match(evidence.retail.reason, /overlap or a source is still syncing/);
    assert.doesNotMatch(prompts.at(-1), /customer-secret|private@example|OTHER TENANT|PRIVATE TEST SECRET/);
    await db.prepare("UPDATE integration_connections SET sync_lease_owner=NULL,sync_lease_expires_at=NULL WHERE id='real-retail'").run();
    response = await dispatch(worker, environment, "/api/v1/advisor/consent", { ...staff, method: "POST", body: { accepted: true, purpose: "help", noticeVersion: askBody.noticeVersion, privacyPolicyVersion: askBody.privacyPolicyVersion } });
    assert.equal(response.status, 200, await response.clone().text());
    response = await ask({ purpose: "help", memoryEnabled: false }); assert.equal(response.status, 200, await response.clone().text());
    evidence = JSON.parse(prompts.at(-1).split("Evidence JSON: ")[1].split("\n\nConversation memory:")[0]); assert.deepEqual(evidence, { purpose: "help", workspaceDataAttached: false });
    response = await dispatch(worker, environment, "/api/v1/advisor/chat", { ...other.owner, method: "DELETE", body: { conversationId: chat.conversationId } }); assert.equal(response.status, 404);
    response = await dispatch(worker, environment, "/api/v1/advisor/chat", { ...staff, method: "DELETE", body: { conversationId: chat.conversationId } }); assert.equal(response.status, 200);
    assert.equal((await db.prepare("SELECT count(*) count FROM assistant_messages WHERE conversation_id=?").bind(chat.conversationId).first()).count, 0);
    assert.equal((await write({ action: "delete", expectedVersion: 1 })).status, 409);
    assert.equal((await write({ action: "delete", expectedVersion: 2 })).status, 200);
    body = await (await load()).json(); assert.equal(body.report.inventory[0].turnover, null);
    const audit = await db.prepare("SELECT count(*) count FROM audit_events WHERE organization_id=? AND action LIKE 'retail.evidence_%'").bind(owner.organizationId).first();
    assert.equal(audit.count, 4);
  } finally { globalThis.fetch = originalFetch; await dispose(); }
});
