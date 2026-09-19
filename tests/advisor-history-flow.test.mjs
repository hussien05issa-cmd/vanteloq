import assert from "node:assert/strict";
import test from "node:test";
import { GET as history } from "../app/api/v1/advisor/conversations/route.ts";
import { POST, ADVISOR_CONSENT_VERSIONS } from "../app/api/v1/advisor/chat/route.ts";
import { ADVISOR_ATTACHMENT_NOTICE_VERSION } from "../shared/advisor-attachments.ts";
import { createEnvironment, createReportWorkspace, dispatch, identityHeaders, origin, seedReportConnection, seedReportMetric } from "./helpers/retail-worker-fixture.mjs";

test("saved AI chats retain historical context while enforcing current personal authority", { timeout: 600000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  const originalFetch = globalThis.fetch, originalEnv = globalThis.__vanteloqEnv;
  const versions = ADVISOR_CONSENT_VERSIONS;
  let afterHistoryRead = null;
  const wrapStatement = (statement, sql) => new Proxy(statement, {
    get(target, key) {
      if (key === "bind") return (...args) => wrapStatement(target.bind(...args), sql);
      if (key === "all") return async (...args) => {
        const result = await target.all(...args);
        if (afterHistoryRead && sql.startsWith("SELECT role,content,evidence_json FROM assistant_messages")) {
          const run = afterHistoryRead; afterHistoryRead = null; await run();
        }
        return result;
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const wrappedDatabase = new Proxy(database, {
    get(target, key) {
      if (key === "prepare") return sql => wrapStatement(target.prepare(sql), sql);
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const activate = () => { globalThis.__vanteloqEnv = { ...environment, DB: wrappedDatabase }; };
  const read = (identity, id) => {
    activate();
    return history(new Request(`${origin}/api/v1/advisor/conversations${id === undefined ? "" : `?id=${encodeURIComponent(id)}`}`, { headers: identityHeaders(identity.owner.email, identity.owner.name) }));
  };
  const ask = (identity, question, body = {}) => {
    activate();
    return POST(new Request(`${origin}/api/v1/advisor/chat`, { method: "POST", headers: identityHeaders(identity.owner.email, identity.owner.name, true), body: JSON.stringify({ ...versions, question, provider: "openai", purpose: "analysis", locationId: identity.locationId, dataUseAccepted: true, memoryEnabled: true, ...body }) }));
  };
  const payload = async (response, status = 200) => {
    assert.equal(response.status, status, await response.clone().text());
    return response.json();
  };
  const accept = async identity => payload(await dispatch(worker, environment, "/api/v1/advisor/consent", { ...identity.owner, method: "POST", body: { ...versions, accepted: true, purpose: "analysis" } }));
  const prompts = [];
  try {
    const a = await createReportWorkspace(worker, environment, database, "history-a");
    const b = await createReportWorkspace(worker, environment, database, "history-b");
    const connectionId = crypto.randomUUID();
    await seedReportConnection(database, { ...a, connectionId, namespace: "history-source", externalLocationRef: "history-outlet" });
    await seedReportMetric(database, { ...a, businessDate: "2026-09-16", locationRef: a.locationId, netSalesCents: 123456 });
    const staff = { organizationId: a.organizationId, locationId: a.locationId, userId: crypto.randomUUID(), owner: { email: `history-staff-${crypto.randomUUID()}@example.invalid`, name: "History staff" } };
    const roleId = crypto.randomUUID(), now = Date.now();
    const permissions = ["dashboard.view", "metrics.revenue", "insights.view"];
    await database.batch([
      database.prepare("INSERT INTO users(id,email,display_name,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)").bind(staff.userId, staff.owner.email, staff.owner.name, now, now),
      database.prepare("INSERT INTO memberships(id,user_id,organization_id,role,status,created_at,updated_at) VALUES(?,?,?,'employee','active',?,?)").bind(crypto.randomUUID(), staff.userId, a.organizationId, now, now),
      database.prepare("INSERT INTO access_roles(id,organization_id,name,description,color,permissions_json,location_scope_json,archived,created_by_user_id,created_at,updated_at) VALUES(?,?,'History reader','','#245fce',?,'[]',0,?,?,?)").bind(roleId, a.organizationId, JSON.stringify(permissions), a.userId, now, now),
      database.prepare("INSERT INTO team_members(id,organization_id,user_id,role_id,first_name,last_name,email,employee_code,primary_location_id,permitted_locations_json,status,remote_login,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,'History','Staff',?,'HISTORY-STAFF',?,?,'active',1,?,?,?)").bind(crypto.randomUUID(), a.organizationId, staff.userId, roleId, staff.owner.email, a.locationId, JSON.stringify([a.locationId]), a.userId, now, now),
    ]);
    for (const identity of [a, b, staff]) await accept(identity);
    environment.OPENAI_API_KEY = "fictional-local-history-test";
    globalThis.fetch = async (input, init) => {
      if (String(input) !== "https://api.openai.com/v1/responses") return originalFetch(input, init);
      const request = JSON.parse(init.body);
      const text = Array.isArray(request.input) ? request.input[0].content[0].text : request.input;
      const question = JSON.parse(text.split("\n\nEvidence JSON:")[0].slice("Question: ".length));
      const evidence = JSON.parse(text.split("\n\nEvidence JSON: ")[1].split("\n\nConversation memory: ")[0]);
      const memory = JSON.parse(text.split("\n\nConversation memory: ")[1]);
      prompts.push({ question, evidence, memory, request });
      return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: `Fictional saved answer: ${question}` }] }] });
    };

    const initial = await payload(await ask(a, "Historical private marker alpha"));
    const id = initial.conversationId;
    assert.ok(id);
    const reopened = await payload(await read(a, id));
    assert.deepEqual(reopened.scope, { purpose: "analysis", locationId: a.locationId, from: null, to: null });
    assert.deepEqual(reopened.messages.map(message => message.role), ["user", "assistant"]);
    assert.match(reopened.messages[0].content, /Historical private marker alpha/);
    const listed = await payload(await read(a));
    assert.ok(listed.conversations.some(chat => chat.id === id));
    assert.doesNotMatch(JSON.stringify(listed), /Historical private marker|Fictional saved answer/);
    await payload(await read(b, id), 404);
    await payload(await read(staff, id), 404);
    await payload(await ask(b, "Foreign history reference", { conversationId: id }), 404);

    // Facts can change without invalidating authority. A follow-up receives new
    // evidence separately from the clearly historical conversation messages.
    await database.prepare("UPDATE daily_business_metrics SET net_sales_cents=234567,gross_sales_cents=234567 WHERE organization_id=?").bind(a.organizationId).run();
    await database.prepare("UPDATE integration_connections SET last_successful_sync_at=?,updated_at=? WHERE id=?").bind(Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), connectionId).run();
    assert.equal((await payload(await read(a, id))).messages.length, 2);
    await payload(await ask(a, "Compare with the earlier review", { conversationId: id }));
    const followup = prompts.at(-1);
    assert.match(JSON.stringify(followup.evidence), /234567/);
    assert.doesNotMatch(JSON.stringify(followup.evidence), /123456/);
    assert.match(JSON.stringify(followup.memory), /Historical private marker alpha/);
    assert.match(followup.request.instructions, /historical context, not current evidence/);
    const evidenceRows = await database.prepare("SELECT evidence_json FROM assistant_messages WHERE conversation_id=?").bind(id).all();
    assert.ok(evidenceRows.results.every(row => /^[a-f0-9]{64}$/.test(JSON.parse(row.evidence_json).authorityFingerprint)));

    await payload(await ask(a, "Change the reporting scope", { conversationId: id, locationId: null }));
    assert.deepEqual(prompts.at(-1).memory, []);
    const changedScope = await payload(await read(a, id));
    assert.equal(changedScope.scope.locationId, null);
    assert.equal(changedScope.messages.length, 2);
    assert.doesNotMatch(JSON.stringify(changedScope.messages), /Historical private marker alpha/);

    // Raw attachment content, its question and any derived answer cannot enter
    // this existing saved conversation even when a client requests memory.
    const beforeMessages = await database.prepare("SELECT COUNT(*) count FROM assistant_messages WHERE conversation_id=?").bind(id).first();
    const form = new FormData();
    form.set("request", JSON.stringify({ ...versions, question: "Attachment private marker", purpose: "analysis", provider: "openai", locationId: a.locationId, dataUseAccepted: true, memoryEnabled: true, conversationId: id, attachmentConsent: ADVISOR_ATTACHMENT_NOTICE_VERSION }));
    form.append("files", new File(["attachment-private-record,123"], "fictional.csv", { type: "text/csv" }));
    const headers = identityHeaders(a.owner.email, a.owner.name, true); delete headers["content-type"];
    activate();
    const attachment = await payload(await POST(new Request(`${origin}/api/v1/advisor/chat`, { method: "POST", headers, body: form })));
    assert.equal(attachment.memoryEnabled, false); assert.equal(attachment.conversationId, null);
    assert.deepEqual(prompts.at(-1).memory, []);
    assert.deepEqual(await database.prepare("SELECT COUNT(*) count FROM assistant_messages WHERE conversation_id=?").bind(id).first(), beforeMessages);
    assert.doesNotMatch(JSON.stringify(await payload(await read(a, id))), /Attachment private marker|attachment-private-record/);

    await database.prepare("UPDATE integration_connections SET data_promotion_status='blocked' WHERE id=?").bind(connectionId).run();
    assert.equal((await payload(await read(a, id), 409)).error.code, "CONVERSATION_ACCESS_CHANGED");
    await database.prepare("UPDATE integration_connections SET data_promotion_status='approved' WHERE id=?").bind(connectionId).run();
    await database.prepare("UPDATE tenant_subscriptions SET status='paused' WHERE organization_id=?").bind(a.organizationId).run();
    assert.equal((await payload(await read(a, id), 402)).error.code, "SUBSCRIPTION_REQUIRED");
    await payload(await read(a)); // Privacy listing stays available without AI access.
    await database.prepare("UPDATE tenant_subscriptions SET status='active' WHERE organization_id=?").bind(a.organizationId).run();

    const staffChat = (await payload(await ask(staff, "Staff private review"))).conversationId;
    await payload(await read(staff, staffChat));
    await database.prepare("UPDATE access_roles SET permissions_json=? WHERE id=?").bind(JSON.stringify(["dashboard.view", "insights.view"]), roleId).run();
    assert.equal((await payload(await read(staff, staffChat), 409)).error.code, "CONVERSATION_ACCESS_CHANGED");
    await database.prepare("UPDATE access_roles SET permissions_json='[]' WHERE id=?").bind(roleId).run();
    await payload(await read(staff, staffChat), 403);
    await database.prepare("UPDATE access_roles SET permissions_json=? WHERE id=?").bind(JSON.stringify(permissions), roleId).run();
    await database.prepare("UPDATE team_members SET permitted_locations_json='[]' WHERE user_id=?").bind(staff.userId).run();
    assert.equal((await payload(await read(staff, staffChat), 403)).error.code, "LOCATION_ACCESS_DENIED");
    await database.prepare("UPDATE team_members SET permitted_locations_json=? WHERE user_id=?").bind(JSON.stringify([a.locationId]), staff.userId).run();
    await database.prepare("UPDATE memberships SET status='suspended' WHERE user_id=?").bind(staff.userId).run();
    await payload(await read(staff, staffChat), 403);
    await database.prepare("UPDATE memberships SET status='active' WHERE user_id=?").bind(staff.userId).run();

    const legacy = (await payload(await ask(a, "Legacy private marker"))).conversationId;
    await database.prepare("UPDATE assistant_messages SET evidence_json='{}' WHERE conversation_id=?").bind(legacy).run();
    assert.equal((await payload(await read(a, legacy), 409)).error.code, "CONVERSATION_LEGACY");
    const expired = (await payload(await ask(a, "Expired private marker"))).conversationId;
    await database.prepare("UPDATE assistant_conversations SET updated_at=? WHERE id=?").bind(Date.now() - 91 * 86400000, expired).run();
    await payload(await read(a, expired), 404);
    const retained = await payload(await read(a));
    assert.ok(!retained.conversations.some(chat => chat.id === expired));
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM assistant_messages WHERE conversation_id=?").bind(expired).first()).count, 0);

    // A revocation after the content query must still prevent the read response.
    afterHistoryRead = () => database.prepare("UPDATE tenant_subscriptions SET status='paused' WHERE organization_id=?").bind(a.organizationId).run();
    const revokedRead = await payload(await read(a, id), 409);
    assert.equal(afterHistoryRead, null);
    assert.equal(revokedRead.error.code, "ADVISOR_CONTEXT_CHANGED");
    assert.equal(revokedRead.messages, undefined);
    await database.prepare("UPDATE tenant_subscriptions SET status='active' WHERE organization_id=?").bind(a.organizationId).run();
    await payload(await dispatch(worker, environment, "/api/v1/advisor/consent", { ...a.owner, method: "DELETE" }));
    const withdrawn = await payload(await read(a, id), 409);
    assert.match(withdrawn.error.code, /^ADVISOR_CONSENT/);
    assert.equal(withdrawn.messages, undefined);
  } finally {
    globalThis.fetch = originalFetch; globalThis.__vanteloqEnv = originalEnv;
    await dispose();
  }
});
