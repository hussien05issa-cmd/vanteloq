import assert from "node:assert/strict";
import test from "node:test";
import { POST, ADVISOR_CONSENT_VERSIONS } from "../app/api/v1/advisor/chat/route.ts";
import { createEnvironment, createReportWorkspace, dispatch, identityHeaders, origin, seedReportConnection, seedReportMetric, seedReportLocation, seedSalesAuthority } from "./helpers/retail-worker-fixture.mjs";

test("AI daily evidence obeys the selected sales authority and excludes duplicate manual and payment feeds", { timeout: 120000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  const originalFetch = globalThis.fetch, originalEnv = globalThis.__vanteloqEnv;
  const prompts = [];
  try {
    const a = await createReportWorkspace(worker, environment, database, "ai-sales-authority");
    const b = await createReportWorkspace(worker, environment, database, "ai-private-sales");
    const manual = await seedReportLocation(database, a.organizationId, "Reviewed entries location");
    const paymentLocation = await seedReportLocation(database, a.organizationId, "Settlement location");
    const seedSource = async (identity, locationId, provider, netSalesCents) => {
      const connectionId = crypto.randomUUID();
      const oldRef = await seedReportConnection(database, { ...identity, locationId, connectionId, namespace: "production:" + crypto.randomUUID(), externalLocationRef: "1" });
      const locationRef = oldRef.replace(/^lightspeed-r:/, provider + ":");
      await database.prepare("UPDATE integration_connections SET provider=? WHERE id=?").bind(provider, connectionId).run();
      await database.prepare("UPDATE integration_location_mappings SET provider=? WHERE connection_id=?").bind(provider, connectionId).run();
      await seedReportMetric(database, { ...identity, businessDate: "2026-10-03", locationRef, netSalesCents, sourceConnectionId: connectionId });
      await database.prepare("UPDATE daily_business_metrics SET source_provider=? WHERE organization_id=? AND source_connection_id=?").bind(provider, identity.organizationId, connectionId).run();
      return connectionId;
    };
    const chosen = await seedSource(a, a.locationId, "lightspeed-r", 1_000);
    await seedSource(a, a.locationId, "square", 2_000);
    await seedSource(a, paymentLocation, "moneris", 9_000);
    await seedReportMetric(database, { ...a, businessDate: "2026-10-03", locationRef: a.locationId, netSalesCents: 99_999 });
    await seedReportMetric(database, { ...a, businessDate: "2026-10-03", locationRef: manual, netSalesCents: 50 });
    await seedSource(b, b.locationId, "lightspeed-r", 88_888);
    await seedSalesAuthority(database, { ...a, connectionId: chosen });
    const consent = await dispatch(worker, environment, "/api/v1/advisor/consent", { ...a.owner, method: "POST", body: { ...ADVISOR_CONSENT_VERSIONS, accepted: true, purpose: "analysis" } });
    assert.equal(consent.status, 200, await consent.clone().text());
    environment.OPENAI_API_KEY = "fictional-local-authority-test";
    globalThis.__vanteloqEnv = environment;
    globalThis.fetch = async (input, init) => {
      if (String(input) !== "https://api.openai.com/v1/responses") return originalFetch(input, init);
      const body = JSON.parse(String(init.body));
      const text = typeof body.input === "string" ? body.input : body.input[0].content[0].text;
      prompts.push(JSON.parse(text.split("\n\nEvidence JSON: ")[1].split("\n\nConversation memory: ")[0]));
      return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Fictional local evidence check." }] }] });
    };
    const ask = locationId => POST(new Request(origin + "/api/v1/advisor/chat", { method: "POST", headers: identityHeaders(a.owner.email, a.owner.name, true), body: JSON.stringify({ ...ADVISOR_CONSENT_VERSIONS, question: "Explain the recorded sales totals", purpose: "analysis", provider: "openai", dataUseAccepted: true, memoryEnabled: false, ...(locationId ? { locationId } : {}) }) }));
    const all = await ask();
    assert.equal(all.status, 200, await all.clone().text());
    assert.equal(prompts.at(-1).kpis.current.netSalesCents, 1_050);
    assert.equal(prompts.at(-1).days[0].netSalesCents, 1_050);
    assert.deepEqual(prompts.at(-1).sources.map(row => row.provider).sort(), ["Recorded business summaries", "lightspeed-r"]);
    const selected = await ask(a.locationId);
    assert.equal(selected.status, 200, await selected.clone().text());
    assert.equal(prompts.at(-1).kpis.current.netSalesCents, 1_000);
    assert.equal(prompts.at(-1).cashAvailableCents, null);
    assert.equal(prompts.at(-1).bookloq.status, "unavailable");
    assert.equal((await ask(b.locationId)).status, 403);
    const beforeConflict = prompts.length;
    await database.prepare("DELETE FROM integration_source_authorities WHERE organization_id=?").bind(a.organizationId).run();
    const conflict = await ask(a.locationId);
    assert.equal(conflict.status, 409, await conflict.clone().text());
    assert.equal((await conflict.json()).error.code, "ADVISOR_SOURCE_CONFLICT");
    assert.equal(prompts.length, beforeConflict, "conflicting sources never reach the AI provider");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.__vanteloqEnv = originalEnv;
    await dispose();
  }
});
