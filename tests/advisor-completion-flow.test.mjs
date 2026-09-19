import assert from "node:assert/strict";
import test from "node:test";
import { ADVISOR_ATTACHMENT_NOTICE_VERSION } from "../shared/advisor-attachments.ts";
import { POST, DELETE, ADVISOR_CONSENT_VERSIONS } from "../app/api/v1/advisor/chat/route.ts";
import { createEnvironment, createReportWorkspace, dispatch, identityHeaders, origin, seedReportMetric } from "./helpers/retail-worker-fixture.mjs";

test("AI requests isolate overlapping tenants and reject access or consent changes before completion", { timeout: 600000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  const originalFetch = globalThis.fetch;
  const originalEnv = globalThis.__vanteloqEnv;
  const versions = ADVISOR_CONSENT_VERSIONS;
  let beforeReply = null, beforeCapture = null, beforeBatch = null, providerHookFailure = null;
  const wrapStatement = (statement, sql) => new Proxy(statement, {
    get(target, key) {
      if (key === "bind") return (...args) => wrapStatement(target.bind(...args), sql);
      if (key === "first") return async (...args) => {
        if (beforeCapture && sql.startsWith("SELECT json_object(")) {
          const run = beforeCapture; beforeCapture = null; await run();
        }
        return target.first(...args);
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const wrappedDatabase = new Proxy(database, {
    get(target, key) {
      if (key === "prepare") return sql => wrapStatement(target.prepare(sql), sql);
      if (key === "batch") return async statements => {
        if (beforeBatch) { const run = beforeBatch; beforeBatch = null; await run(); }
        return target.batch(statements);
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const totalMessages = async identity => Number((await database.prepare("SELECT COUNT(*) count FROM assistant_messages WHERE organization_id=? AND user_id=?").bind(identity.organizationId, identity.userId).first()).count);
  const accept = async identity => {
    const response = await dispatch(worker, environment, "/api/v1/advisor/consent", { ...identity.owner, method: "POST", body: { ...versions, accepted: true, purpose: "analysis" } });
    assert.equal(response.status, 200, await response.clone().text());
  };
  const withdraw = async identity => {
    const response = await dispatch(worker, environment, "/api/v1/advisor/consent", { ...identity.owner, method: "DELETE" });
    assert.equal(response.status, 200, await response.clone().text());
  };
  try {
    const a = await createReportWorkspace(worker, environment, database, "private-a");
    const b = await createReportWorkspace(worker, environment, database, "private-b");
    for (const [identity, amount] of [[a, 123456], [b, 987654]]) {
      await seedReportMetric(database, { ...identity, businessDate: "2026-09-16", locationRef: identity.locationId, netSalesCents: amount });
      await accept(identity);
    }
    environment.OPENAI_API_KEY = "fictional-local-test-only";
    const prompts = [];
    globalThis.fetch = async (input, init) => {
      if (String(input) !== "https://api.openai.com/v1/responses") return originalFetch(input, init);
      const inputBody = JSON.parse(init.body).input;
      const prompt = Array.isArray(inputBody) ? inputBody[0].content[0].text : inputBody;
      prompts.push(prompt);
      if (beforeReply) {
        try { await beforeReply(); }
        catch (error) { providerHookFailure = error; throw error; }
      }
      const question = JSON.parse(prompt.split("\n\nEvidence JSON:")[0].slice("Question: ".length));
      return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: `Fictional answer for ${question}` }] }] });
    };
    const ask = (identity, question, body = {}) => {
      globalThis.__vanteloqEnv = { ...environment, DB: wrappedDatabase };
      return POST(new Request(`${origin}/api/v1/advisor/chat`, { method: "POST", headers: identityHeaders(identity.owner.email, identity.owner.name, true), body: JSON.stringify({ ...versions, question, provider: "openai", dataUseAccepted: true, memoryEnabled: true, ...body }) }));
    };
    const overlap = async requests => {
      let entered = 0, release;
      const barrier = new Promise(resolve => { release = resolve; });
      beforeReply = async () => { if (++entered === 2) release(); await barrier; };
      try { const result = await Promise.all(requests.map(run => run())); assert.equal(entered, 2); return result; }
      finally { beforeReply = null; }
    };
    const first = await overlap([() => ask(a, "Private marker alpha"), () => ask(b, "Private marker beta")]);
    const ids = [];
    for (const response of first) { assert.equal(response.status, 200, await response.clone().text()); ids.push((await response.json()).conversationId); }
    const followups = await overlap([() => ask(a, "Follow up alpha", { conversationId: ids[0] }), () => ask(b, "Follow up beta", { conversationId: ids[1] })]);
    for (const response of followups) assert.equal(response.status, 200, await response.clone().text());
    const alpha = prompts.find(prompt => prompt.startsWith('Question: "Follow up alpha"'));
    const beta = prompts.find(prompt => prompt.startsWith('Question: "Follow up beta"'));
    assert.match(alpha, /Private marker alpha/); assert.doesNotMatch(alpha, /Private marker beta|987654/);
    assert.match(beta, /Private marker beta/); assert.doesNotMatch(beta, /Private marker alpha|123456/);
    assert.equal((await ask(b, "Foreign conversation", { conversationId: ids[0] })).status, 404);
    assert.equal(await totalMessages(a), 4); assert.equal(await totalMessages(b), 4);

    // A malicious client cannot persist an attachment turn by enabling memory.
    const attach = async (consent = ADVISOR_ATTACHMENT_NOTICE_VERSION) => {
      const form = new FormData();
      form.set("request", JSON.stringify({ ...versions, question: "Read the fictional file", provider: "openai", purpose: "help", dataUseAccepted: true, memoryEnabled: true, conversationId: ids[0], attachmentConsent: consent }));
      form.append("files", new File(["Fictional product,cost\nA,14.50"], "fictional.csv", {type:"text/csv"}));
      const headers = identityHeaders(a.owner.email, a.owner.name, true); delete headers["content-type"];
      globalThis.__vanteloqEnv = { ...environment, DB: wrappedDatabase };
      return POST(new Request(`${origin}/api/v1/advisor/chat`, { method:"POST", headers, body:form }));
    };
    const documentsBefore = await database.prepare("SELECT COUNT(*) count FROM workspace_documents").first();
    const missingConsentCalls = prompts.length;
    const noConsent = await attach(null); assert.equal(noConsent.status,409,await noConsent.clone().text());
    assert.equal(prompts.length,missingConsentCalls);
    const attachmentReply = await attach(); assert.equal(attachmentReply.status,200,await attachmentReply.clone().text());
    const attachmentPayload = await attachmentReply.json();
    assert.equal(attachmentPayload.memoryEnabled,false); assert.equal(attachmentPayload.conversationId,null);
    assert.equal(await totalMessages(a),4);
    assert.deepEqual(await database.prepare("SELECT COUNT(*) count FROM workspace_documents").first(),documentsBefore);
    beforeReply = () => withdraw(a);
    const attachmentRevoked = await attach(); assert.equal(attachmentRevoked.status,409,await attachmentRevoked.clone().text());
    assert.equal(Boolean((await attachmentRevoked.json()).answer),false); assert.equal(await totalMessages(a),4);
    beforeReply = null; await accept(a);

    beforeReply = () => withdraw(a);
    const withdrawn = await ask(a, "Reply after withdrawal");
    assert.equal(withdrawn.status, 409, await withdrawn.clone().text());
    assert.equal(Boolean((await withdrawn.json()).answer), false);
    assert.equal(await totalMessages(a), 4);
    await accept(a);
    const privateWithdrawn = await ask(a, "Private reply after withdrawal", { memoryEnabled: false });
    assert.equal(privateWithdrawn.status, 409, await privateWithdrawn.clone().text());
    assert.equal(Boolean((await privateWithdrawn.json()).answer), false);
    assert.equal(await totalMessages(a), 4);

    beforeReply = async () => { await database.prepare("UPDATE memberships SET status='suspended' WHERE user_id=? AND organization_id=?").bind(b.userId, b.organizationId).run(); };
    const suspended = await ask(b, "Reply after access removal");
    assert.equal(suspended.status, 403, await suspended.clone().text());
    assert.equal(Boolean((await suspended.json()).answer), false);
    assert.equal(await totalMessages(b), 4);
    beforeReply = null;

    await accept(a);
    // A withdrawal that wins after all fresh route checks must still block the
    // actual D1 INSERT, not just a preceding read check.
    beforeBatch = () => withdraw(a);
    const atomicWithdrawn = await ask(a, "Withdrawal immediately before persistence");
    assert.equal(beforeBatch, null, "The guarded completion batch must be exercised.");
    assert.equal(atomicWithdrawn.status, 409, await atomicWithdrawn.clone().text());
    assert.equal(Boolean((await atomicWithdrawn.json()).answer), false);
    assert.equal(await totalMessages(a), 4);

    await accept(a);
    const beforeCount = prompts.length;
    beforeCapture = () => database.prepare("UPDATE tenant_subscriptions SET status='paused' WHERE organization_id=?").bind(a.organizationId).run();
    const paused = await ask(a, "Plan changed before evidence capture");
    assert.equal(beforeCapture, null, "The authority capture race must be exercised.");
    assert.equal(paused.status, 402, await paused.clone().text());
    assert.equal((await paused.json()).error.code, "SUBSCRIPTION_REQUIRED");
    assert.equal(prompts.length, beforeCount, "Revoked feature access must prevent sending to the provider.");
    assert.equal(await totalMessages(a), 4);
    await database.prepare("UPDATE tenant_subscriptions SET status='active' WHERE organization_id=?").bind(a.organizationId).run();

    beforeReply = async () => {
      const response = await DELETE(new Request(`${origin}/api/v1/advisor/chat`, { method: "DELETE", headers: identityHeaders(a.owner.email, a.owner.name, true), body: JSON.stringify({ conversationId: ids[0] }) }));
      assert.equal(response.status, 200, await response.clone().text());
    };
    const deleted = await ask(a, "Reply after conversation deletion", { conversationId: ids[0] });
    assert.equal(providerHookFailure, null, "The fictional provider hook must complete its actual deletion.");
    assert.equal(deleted.status, 409, await deleted.clone().text());
    assert.equal(Boolean((await deleted.json()).answer), false);
    assert.equal(await totalMessages(a), 0);
    assert.equal((await database.prepare("SELECT id FROM assistant_conversations WHERE id=?").bind(ids[0]).first()), null);
  } finally { globalThis.fetch = originalFetch; globalThis.__vanteloqEnv = originalEnv; await dispose(); }
});
