import assert from "node:assert/strict";
import test from "node:test";
import { createEnvironment, createReportWorkspace, dispatch, identityHeaders, origin, context } from "./helpers/retail-worker-fixture.mjs";

const details = {
  invoiceNumber: "QA-275", invoiceDate: "2026-09-18", dueDate: "2026-10-18", currency: "CAD",
  issuer: { name: "Fictional Business", address: "1 Test Street\nEdmonton, AB", email: "billing@example.invalid" },
  customer: { name: "Fictional Customer", address: "2 Test Street\nEdmonton, AB", email: "customer@example.invalid" },
  lines: [{ description: "Fictional fractional service", quantityMilli: 20, unitPriceCents: 725, taxRateBasisPoints: 500 }],
};
test("built invoice creation, retry and state preservation; upload-only documents stay private", { timeout: 120000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  const actualFetch = globalThis.fetch;
  try {
    const account = await createReportWorkspace(worker, environment, database, "invoice-review");
    const now = Math.floor(Date.now() / 1000);
    await database.prepare("INSERT INTO tenant_addons(id,organization_id,addon_key,status,created_at,updated_at) VALUES (?,?,'bookloq','active',?,?)").bind(crypto.randomUUID(), account.organizationId, now, now).run();
    const objects = new Map(); let puts = 0;
    environment.BUCKET = {
      put: async (key, bytes, options) => { puts++; objects.set(key, { bytes, ...options }); },
      get: async key => { const item = objects.get(key); return item ? { body: new Uint8Array(item.bytes), customMetadata: item.customMetadata } : null; },
      delete: async key => { objects.delete(key); },
    };
    const headers = identityHeaders(account.owner.email, account.owner.name, true); delete headers["content-type"];
    const post = form => worker.fetch(new Request(origin + "/api/v1/bookloq/invoices", { method: "POST", headers, body: form }), environment, context);
    const large = new FormData(); large.set("invoice", JSON.stringify(details)); large.set("unused", "x".repeat(2_500_000));
    assert.equal((await post(large)).status, 413); assert.equal(puts, 0);
    const invalid = new FormData(); invalid.set("invoice", JSON.stringify({ ...details, invoiceDate: "2026-02-30" }));
    assert.equal((await post(invalid)).status, 400); assert.equal(puts, 0);
    const form = new FormData(); form.set("invoice", JSON.stringify(details));
    const created = await post(form); assert.equal(created.status, 201, await created.clone().text());
    const { invoice } = await created.json(); assert.equal(invoice.totalCents, 16); assert.equal(puts, 1);
    assert.equal((await post(form)).status, 409); assert.equal(puts, 1);
    const email = () => dispatch(worker, environment, "/api/v1/bookloq/invoices/email", { ...account.owner, method: "POST", body: { invoiceId: invoice.id, to: "customer@example.invalid", message: "Fictional test only" } });
    assert.equal((await email()).status, 503);
    assert.equal((await database.prepare("SELECT status FROM customer_invoices WHERE id=?").bind(invoice.id).first()).status, "draft");
    environment.RESEND_API_KEY = "fixture-only-not-a-real-key";
    let requests = 0, duringDelivery = null; const keys = [];
    globalThis.fetch = async (input, options) => {
      if (String(input) === "https://api.resend.com/emails") {
        requests++; keys.push(options.headers["Idempotency-Key"]);
        if (duringDelivery) await duringDelivery();
        return Response.json({ id: "fictional-delivery" });
      }
      return actualFetch(input, options);
    };
    for (const status of ["draft", "approved", "partially_paid", "paid"]) {
      await database.prepare("UPDATE customer_invoices SET status=? WHERE id=?").bind(status, invoice.id).run();
      const sent = await email(); assert.equal(sent.status, 200, await sent.clone().text());
      assert.equal((await sent.json()).status, ["draft", "approved"].includes(status) ? "sent" : status);
    }
    for (const status of ["written_off", "void"]) {
      await database.prepare("UPDATE customer_invoices SET status=? WHERE id=?").bind(status, invoice.id).run();
      assert.equal((await email()).status, 409);
    }
    assert.equal(requests, 4); assert.ok(keys[0]); assert.equal(new Set(keys).size, 1, "uncertain retries deduplicate at the provider");
    await database.prepare("UPDATE customer_invoices SET status='draft' WHERE id=?").bind(invoice.id).run();
    duringDelivery = () => database.prepare("UPDATE customer_invoices SET status='paid' WHERE id=?").bind(invoice.id).run();
    assert.equal((await (await email()).json()).status, "paid", "delivery cannot overwrite a concurrent accounting state change");

    const role = crypto.randomUUID(), employee = { email: "upload-only-" + crypto.randomUUID() + "@example.invalid", name: "Upload Only" }, user = crypto.randomUUID();
    await database.batch([
      database.prepare("INSERT INTO users(id,email,display_name,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)").bind(user, employee.email, employee.name, now, now),
      database.prepare("INSERT INTO memberships(id,user_id,organization_id,role,status,created_at,updated_at) VALUES(?,?,?,'employee','active',?,?)").bind(crypto.randomUUID(), user, account.organizationId, now, now),
      database.prepare("INSERT INTO access_roles(id,organization_id,name,description,color,permissions_json,location_scope_json,archived,created_by_user_id,created_at,updated_at) VALUES(?,?,'Upload only','','#245fce','[\"documents.upload\"]','[]',0,?,?,?)").bind(role, account.organizationId, account.userId, now, now),
      database.prepare("INSERT INTO team_members(id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,primary_location_id,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,'Upload','Only',?,'UPLOAD',?,?,'active',1,?,?,?)").bind(crypto.randomUUID(), account.organizationId, user, role, employee.email, account.locationId, JSON.stringify([account.locationId]), account.userId, now, now),
    ]);
    assert.equal((await dispatch(worker, environment, "/api/v1/documents", employee)).status, 403);
    const employeeHeaders = identityHeaders(employee.email, employee.name, true); delete employeeHeaders["content-type"];
    const document = new FormData(); document.set("file", new Blob(["%PDF-1.4\nFictional private receipt\n%%EOF"], { type: "application/pdf" }), "Private-receipt.pdf");
    const upload = () => worker.fetch(new Request(origin + "/api/v1/documents", { method: "POST", headers: employeeHeaders, body: document }), environment, context);
    const uploaded = await upload(); assert.equal(uploaded.status, 201, await uploaded.clone().text());
    assert.deepEqual(Object.keys(await uploaded.json()), ["uploadedId"]);
    const duplicate = await upload(); assert.equal(duplicate.status, 409);
    assert.doesNotMatch(await duplicate.text(), /Private-receipt|QA-275/);
  } finally { globalThis.fetch = actualFetch; await dispose(); }
});
