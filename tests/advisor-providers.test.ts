import test from "node:test";
import assert from "node:assert/strict";
import { callAdvisor, advisorProviderStatus } from "../server/advisor-providers.ts";
import { isAdvisorMode, type AdvisorMode } from "../domain/advisor-providers.ts";
import { Miniflare } from "miniflare";
import { ADVISOR_APP_HELP_INSTRUCTIONS } from "../server/advisor-instructions.ts";
const env = { OPENAI_API_KEY: "fixture-openai-key" };
test("App help selects instructions that do not claim to inspect a user's account", async () => {
  const request = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.instructions, ADVISOR_APP_HELP_INSTRUCTIONS);
    assert.match(body.instructions, /No workspace records were requested or attached/);
    assert.equal(body.store, false);
    return Response.json({status:"completed",output:[{type:"message",content:[{type:"output_text",text:"Product help only"}]}]});
  }) as typeof fetch;
  await callAdvisor("openai", "How do I check BookLoQ?", env, request, "help");
});
test("removed provider modes fail before any evidence leaves the server", async () => {
  let calls = 0;
  const request = (async () => { calls++; return Response.json({}); }) as typeof fetch;
  assert.deepEqual(Object.keys(advisorProviderStatus(env)), ["openai"]);
  for (const mode of ["gemini", "both", "", "OPENAI"]) {
    assert.equal(isAdvisorMode(mode), false);
    await assert.rejects(callAdvisor(mode as AdvisorMode, "private evidence", env, request), /OpenAI only/);
  }
  assert.equal((await callAdvisor("openai", "private evidence", {}, request)).configured, false);
  assert.equal(calls, 0);
});

test("OpenAI gets permitted evidence only through protected server requests", async () => {
  let calls = 0;
  const request = (async (url, init) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${env.OPENAI_API_KEY}`);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.input, "approved evidence");
    assert.match(body.instructions, /Risk analysis:|Marketing:|Finance:/);
    assert.doesNotMatch(body.instructions, /approved evidence/);
    assert.equal(body.store, false);
    assert.equal(body.tools, undefined);
    assert.equal(init?.redirect, "manual");
    assert.ok(init?.signal);
    return Response.json({status:"completed",output:[{type:"reasoning",content:[{type:"output_text",text:"hidden reasoning"}]},{type:"message",content:[{type:"output_text",text:"OpenAI analysis"}]}]});
  }) as typeof fetch;
  const result = await callAdvisor("openai", "approved evidence", env, request);
  assert.equal(result.configured, true);
  assert.deepEqual(result.providers, ["openai"]);
  assert.equal(result.text, "OpenAI analysis");
  assert.equal(calls, 1);
});

test("provider requests are accepted by the actual Worker Request implementation", async () => {
  const runtime = new Miniflare({
    modules: true,
    compatibilityDate: "2026-05-15",
    script: `export default { async fetch(incoming) {
      const {url, init} = await incoming.json();
      const request = new Request(url, {...init, signal: AbortSignal.timeout(45000)});
      return Response.json({redirect: request.redirect, method: request.method});
    } }`,
  });
  try {
    const request = (async (url, init) => {
      const response = await runtime.dispatchFetch("https://runtime-test.invalid", {
        method: "POST", body: JSON.stringify({url, init: {...init, signal: undefined}}),
      });
      assert.equal(response.status, 200, "The Worker must accept the provider request options");
      assert.deepEqual(await response.json(), {redirect: "manual", method: "POST"});
      return Response.json({status:"completed",output:[{type:"message",content:[{type:"output_text",text:"Runtime verified"}]}]});
    }) as typeof fetch;
    const result = await callAdvisor("openai", "Fictional runtime test", env, request);
    assert.deepEqual(result.providers, ["openai"]);
  } finally {
    await runtime.dispose();
  }
});
test("provider redirects fail closed without following or exposing a new destination", async () => {
  for (const provider of ["openai"] as const) {
    let calls = 0;
    const request = (async (_url, init) => {
      calls++;
      assert.equal(init?.redirect, "manual");
      return new Response("Untrusted redirect body", {status: 307, headers: {location: "https://untrusted.invalid/collect"}});
    }) as typeof fetch;
    await assert.rejects(callAdvisor(provider, "Fictional evidence", env, request), /could not complete/);
    assert.equal(calls, 1);
  }
});
test("incomplete or empty OpenAI output fails safely without retrying another provider", async () => {
  let calls=0;
  const request=(async()=>{calls++;return Response.json({status:"incomplete",output:[{type:"message",content:[{type:"output_text",text:"Partial financial calculation"}]}]});}) as typeof fetch;
  await assert.rejects(callAdvisor("openai","evidence",env,request),/could not complete/); assert.equal(calls,1);
});

test("billing failures give an actionable message without leaking provider diagnostics", async () => {
  for (const [error, expectedCode] of [
    [{code:"credit_balance_exhausted",type:"insufficient_quota"}, "ADVISOR_CREDITS_REQUIRED"],
    [{code:"project_spend_limit_exceeded",type:"insufficient_quota"}, "ADVISOR_BILLING_REQUIRED"],
    [{code:"rate_limit_exceeded",type:"rate_limit_error"}, "ADVISOR_RATE_LIMITED"],
  ] as const) {
    let calls = 0;
    const request = (async () => { calls++; return Response.json({error:{...error,message:"Private upstream diagnostics: key and account details"}}, {status:429}); }) as typeof fetch;
    await assert.rejects(callAdvisor("openai","fictional evidence",env,request), (failure: unknown) => {
      assert.equal((failure as {code:string}).code,expectedCode);
      assert.doesNotMatch(String(failure),/Private upstream|key and account/);
      return true;
    });
    assert.equal(calls,1);
  }
});
