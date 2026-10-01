import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import { createEnvironment, createReportWorkspace, dispatch, origin, context } from "./helpers/retail-worker-fixture.mjs";

test("Shopify privacy requests remain private and pending through disconnect, retries and explicit owner fulfilment", async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  const secret = "fixture-only-shopify-privacy-secret";
  Object.assign(environment, { SHOPIFY_CLIENT_ID: "fixture-shopify-client", SHOPIFY_CLIENT_SECRET: secret,
    SHOPIFY_COMMERCE_REDIRECT_URI: origin + "/api/v1/integrations/shopify/callback", SHOPIFY_COMMERCE_WEBHOOK_URL: origin + "/api/v1/integrations/shopify/webhook",
    SHOPIFY_REDIRECT_URI: origin + "/api/v1/integrations/shopify-pos/callback", SHOPIFY_WEBHOOK_URL: origin + "/api/v1/integrations/shopify-pos/webhook",
    INTEGRATION_ENCRYPTION_KEY: Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => i + 1)).toString("base64") });
  const now = Math.floor(Date.now() / 1000), api = "/api/v1/integrations/shopify/privacy";
  const hook = (topic, payload, { shop = payload.shop_domain ?? payload.myshopify_domain, signature, webhookId = randomUUID() } = {}) => {
    const body = JSON.stringify(payload);
    return worker.fetch(new Request(origin + "/api/v1/integrations/shopify/webhook", { method: "POST", body, headers: {
      "content-type": "application/json", "x-shopify-topic": topic, "x-shopify-shop-domain": shop,
      "x-shopify-webhook-id": webhookId, "x-shopify-hmac-sha256": signature ?? createHmac("sha256", secret).update(body).digest("base64"),
    } }), environment, context);
  };
  try {
    const a = await createReportWorkspace(worker, environment, database, "privacy-a"), b = await createReportWorkspace(worker, environment, database, "privacy-b");
    const seed = async (workspace, id, shop, { legacy = false, unverified = false } = {}) => {
      await database.prepare(`INSERT INTO integration_connections(id,organization_id,provider,source_namespace,status,domain_prefix,external_account_ref,connected_at,created_at,updated_at,data_promotion_status)
        VALUES (?,?,?,?,?,?, ?,?,?,?,'staging')`).bind(id, workspace.organizationId, unverified ? 'shopify-pos' : 'shopify', id, legacy ? "revoked" : unverified ? "error" : "connected", legacy ? null : shop, unverified || legacy ? null : shop, unverified || legacy ? null : now, now, now).run();
      if (unverified) return;
      await database.prepare(`INSERT INTO audit_events(id,organization_id,action,resource_type,resource_id,outcome,request_id,details_json,created_at)
        VALUES (?,?,'integration.connected','integration',?,'success','fixture',?,?)`).bind(randomUUID(), workspace.organizationId, id, JSON.stringify({ provider: "shopify", shop }), now).run();
      await database.prepare(`INSERT INTO integration_sync_runs(id,organization_id,provider,connection_id,mode,status,started_at) VALUES (?,?,'shopify',?,'sample','completed',?)`).bind("run-" + id, workspace.organizationId, id, now).run();
      await database.prepare(`INSERT INTO commerce_customers(id,organization_id,provider,connection_id,external_customer_id,display_name,email,source_payload_hash,sync_run_id,updated_at)
        VALUES (?,?,'shopify',?,?,'Fixture customer',?,'fixture',?,?)`).bind("customer-" + id, workspace.organizationId, id, id + ":gid://shopify/Customer/44", id + "@example.invalid", "run-" + id, now).run();
      await database.prepare(`INSERT INTO commerce_sale_lines(id,organization_id,provider,connection_id,external_sale_id,external_line_id,customer_ref,product_name,quantity_milli,net_sales_cents,source_payload_hash,sync_run_id,updated_at)
        VALUES (?,?,'shopify',?,?,?,?,'Fixture product',1000,1200,'fixture',?,?)`).bind("line-" + id, workspace.organizationId, id, id + ":gid://shopify/Order/55", "line-1", id + ":gid://shopify/Customer/44", "run-" + id, now).run();
      await database.prepare(`INSERT INTO commerce_payments(id,organization_id,provider,connection_id,external_payment_id,external_sale_id,payment_type_name,amount_cents,source_payload_hash,sync_run_id,updated_at)
        VALUES (?,?,'shopify',?,'payment-1',?,'Card',1200,'fixture',?,?)`).bind("payment-" + id, workspace.organizationId, id, id + ":gid://shopify/Order/55", "run-" + id, now).run();
      await database.prepare(`INSERT INTO integration_staged_sales(id,organization_id,provider,connection_id,external_sale_id,external_version,state,total_cents,source_payload_hash,sync_run_id,staged_at)
        VALUES (?,?,'shopify',?,?,'1','completed',1200,'fixture',?,?)`).bind("staged-" + id, workspace.organizationId, id, id + ":gid://shopify/Order/55", "run-" + id, now).run();
    };
    await seed(a, "privacy-a", "privacy-a.myshopify.com");
    await seed(b, "privacy-b", "privacy-b.myshopify.com");
    await seed(a, "privacy-legacy", "legacy.myshopify.com", { legacy: true });
    await seed(b, "privacy-unverified", "privacy-a.myshopify.com", { unverified: true });
    const payload = { shop_id: 1, shop_domain: "privacy-a.myshopify.com", data_request: { id: 10 }, customer: { id: 44, email: "requester@example.invalid", phone: "excluded" }, orders_requested: [55] };
    assert.equal((await hook("customers/data_request", payload, { signature: "invalid" })).status, 401);
    assert.equal((await hook("customers/data_request", payload, { shop: "privacy-b.myshopify.com" })).status, 400);
    assert.equal((await database.prepare("SELECT COUNT(*) n FROM shopify_privacy_requests").first()).n, 0);
    // The receipt survives a queue failure, and the exact retry must finish queueing.
    await database.prepare("CREATE TRIGGER privacy_task_failure BEFORE INSERT ON workspace_tasks BEGIN SELECT RAISE(ABORT,'fixture queue failure'); END").run();
    assert.equal((await hook("customers/data_request", payload)).status, 500);
    await database.prepare("DROP TRIGGER privacy_task_failure").run();
    const accepted = await hook("customers/data_request", payload);
    assert.equal(accepted.status, 200, await accepted.clone().text());
    assert.equal((await accepted.json()).queued, true);
    assert.equal((await hook("customers/data_request", payload)).status, 200);
    const request = await database.prepare("SELECT * FROM shopify_privacy_requests WHERE organization_id=?").bind(a.organizationId).first();
    assert.equal(request.status, "pending"); assert.equal(request.due_at - request.received_at, 30 * 86_400);
    assert.match(request.request_ciphertext, /^v1\./); assert.doesNotMatch(request.request_ciphertext, /requester|example|orders_requested/);
    assert.equal((await database.prepare("SELECT COUNT(*) n FROM shopify_privacy_requests").first()).n, 1, "unverified grants and unrelated stores cannot receive request data");
    const tasks = await dispatch(worker, environment, "/api/v1/tasks", a.owner), taskBody = await tasks.json();
    assert.equal(tasks.status, 200); const task = taskBody.tasks.find(t => t.sourceRef === "shopify-privacy:" + request.id);
    assert.ok(task); assert.equal(task.priority, "high"); assert.doesNotMatch(JSON.stringify(task), /requester@example|Customer\/44|Order\/55/);
    assert.equal((await database.prepare("SELECT COUNT(*) n FROM workspace_tasks WHERE source_ref=?").bind(task.sourceRef).first()).n, 1);
    assert.equal((await dispatch(worker, environment, "/api/v1/tasks", { method: "PATCH", ...a.owner, body: { id: task.id, status: "done" } })).status, 409);
    assert.equal((await dispatch(worker, environment, api, { method: "POST", ...b.owner, body: { action: "export", id: request.id } })).status, 404);
    assert.deepEqual((await (await dispatch(worker, environment, api, b.owner)).json()).requests, []);
    await database.prepare("UPDATE memberships SET role='employee' WHERE organization_id=? AND user_id=?").bind(a.organizationId, a.userId).run();
    assert.equal((await dispatch(worker, environment, api, a.owner)).status, 403);
    await database.prepare("UPDATE memberships SET role='owner' WHERE organization_id=? AND user_id=?").bind(a.organizationId, a.userId).run();
    const completion = { action: "complete", id: request.id, method: "secure_delivery", reference: "fixture-delivery-1", confirmed: true };
    assert.equal((await dispatch(worker, environment, api, { method: "POST", ...a.owner, body: completion })).status, 409, "acknowledgement alone cannot complete a privacy request");
    const disconnected = await dispatch(worker, environment, "/api/v1/integrations/shopify/disconnect", { method: "POST", ...a.owner, body: { connectionId: "privacy-a" } });
    assert.equal(disconnected.status, 200, await disconnected.clone().text());
    const connection = await database.prepare("SELECT status,domain_prefix,connected_at FROM integration_connections WHERE id='privacy-a'").first();
    assert.equal(connection.status, "revoked"); assert.equal(connection.domain_prefix, payload.shop_domain); assert.ok(connection.connected_at);
    // Privacy response is independent of paid product access.
    await database.prepare("UPDATE tenant_subscriptions SET status='canceled' WHERE organization_id=?").bind(a.organizationId).run();
    assert.equal((await dispatch(worker, environment, api, a.owner)).status, 200);
    const exported = await dispatch(worker, environment, api, { method: "POST", ...a.owner, body: { action: "export", id: request.id } });
    assert.equal(exported.status, 200, await exported.clone().text()); assert.equal(exported.headers.get("cache-control"), "no-store, max-age=0");
    const exportedBody = await exported.json(); assert.equal(exportedBody.complete, true);
    for (const category of ["customers", "saleLines", "payments", "stagedOrders"]) assert.equal(exportedBody.records[category].length, 1);
    assert.doesNotMatch(JSON.stringify(exportedBody), /privacy-b@example|privacy-unverified/);
    assert.equal((await database.prepare("SELECT status FROM shopify_privacy_requests WHERE id=?").bind(request.id).first()).status, "pending");
    assert.equal((await dispatch(worker, environment, api, { method: "POST", ...a.owner, body: { ...completion, method: "no_retained_data" } })).status, 409);
    assert.equal((await dispatch(worker, environment, api, { method: "POST", ...a.owner, body: completion })).status, 200);
    const completed = await database.prepare("SELECT status,request_ciphertext,completion_reference_hash FROM shopify_privacy_requests WHERE id=?").bind(request.id).first();
    assert.equal(completed.status, "completed"); assert.equal(completed.request_ciphertext, ""); assert.match(completed.completion_reference_hash, /^[a-f0-9]{64}$/);
    assert.equal((await database.prepare("SELECT status FROM workspace_tasks WHERE id=?").bind(task.id).first()).status, "done");
    assert.equal((await hook("customers/data_request", payload)).status, 200);
    assert.equal((await database.prepare("SELECT status FROM integration_webhook_events WHERE external_object_ref=?").bind(request.id).first()).status, "processed");
    // Older disconnected records remain reachable through a verified connection audit.
    const legacyPayload = { ...payload, shop_domain: "legacy.myshopify.com", data_request: { id: 11 } };
    assert.equal((await hook("customers/data_request", legacyPayload)).status, 200);
    assert.equal((await database.prepare("SELECT COUNT(*) n FROM shopify_privacy_requests WHERE connection_id='privacy-legacy'").first()).n, 1);
    // An email-only redaction is valid. Failure must leave a retryable receipt.
    const redact = { shop_domain: "privacy-a.myshopify.com", customer: { email: "privacy-a@example.invalid" }, orders_to_redact: [55] };
    await database.prepare("CREATE TRIGGER privacy_redaction_failure BEFORE DELETE ON commerce_customers WHEN OLD.connection_id='privacy-a' BEGIN SELECT RAISE(ABORT,'fixture redaction failure'); END").run();
    assert.equal((await hook("customers/redact", redact)).status, 500);
    await database.prepare("DROP TRIGGER privacy_redaction_failure").run();
    assert.equal((await hook("customers/redact", redact)).status, 200);
    assert.equal((await database.prepare("SELECT COUNT(*) n FROM commerce_customers WHERE connection_id='privacy-a'").first()).n, 0);
    assert.equal((await database.prepare("SELECT customer_ref FROM commerce_sale_lines WHERE connection_id='privacy-a'").first()).customer_ref, null);
    assert.equal((await database.prepare("SELECT COUNT(*) n FROM commerce_customers WHERE connection_id='privacy-b'").first()).n, 1);
    assert.equal((await hook("shop/redact", { shop_domain: "privacy-a.myshopify.com", shop_id: 1 })).status, 200);
    for (const table of ["commerce_sale_lines", "commerce_payments", "integration_staged_sales"]) assert.equal((await database.prepare(`SELECT COUNT(*) n FROM ${table} WHERE connection_id='privacy-a'`).first()).n, 0);
    const emptyPayload = { ...payload, data_request: { id: 12 } };
    assert.equal((await hook("customers/data_request", emptyPayload)).status, 200);
    const emptyRequest = await database.prepare("SELECT id FROM shopify_privacy_requests WHERE connection_id='privacy-a' AND status='pending'").first();
    const emptyExport = await dispatch(worker, environment, api, { method: "POST", ...a.owner, body: { action: "export", id: emptyRequest.id } });
    assert.equal(emptyExport.status, 200, await emptyExport.clone().text());
    assert.ok(Object.values((await emptyExport.json()).records).every(rows => rows.length === 0));
    assert.equal((await dispatch(worker, environment, api, { method: "POST", ...a.owner, body: { ...completion, id: emptyRequest.id, method: "no_retained_data", reference: "fixture-empty-response" } })).status, 200);
    const legacyRequest = await database.prepare("SELECT id FROM shopify_privacy_requests WHERE connection_id='privacy-legacy'").first();
    await database.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1001)
      INSERT INTO commerce_sale_lines(id,organization_id,provider,connection_id,external_sale_id,external_line_id,customer_ref,product_name,quantity_milli,net_sales_cents,source_payload_hash,sync_run_id,updated_at)
      SELECT 'overflow-'||x,?,'shopify','privacy-legacy','privacy-legacy:gid://shopify/Order/55','overflow-'||x,'privacy-legacy:gid://shopify/Customer/44','Fixture',1000,1,'fixture','run-privacy-legacy',? FROM n`).bind(a.organizationId,now).run();
    assert.equal((await dispatch(worker, environment, api, { method: "POST", ...a.owner, body: { action: "export", id: legacyRequest.id } })).status, 409, "bounded export never silently truncates a customer response");
    assert.equal((await dispatch(worker, environment, api, { method: "POST", ...a.owner, body: { ...completion, id: legacyRequest.id } })).status, 409);
    // This isolated workspace contains no posted financial records.
    await database.prepare("DELETE FROM workspaces WHERE id=?").bind(a.organizationId).run();
    assert.equal((await database.prepare("SELECT COUNT(*) n FROM shopify_privacy_requests WHERE organization_id=?").bind(a.organizationId).first()).n, 0, "workspace deletion erases encrypted pending scope and completion receipts");
    assert.equal((await database.prepare("SELECT COUNT(*) n FROM commerce_customers WHERE connection_id='privacy-b'").first()).n, 1);
  } finally { await dispose(); }
});
