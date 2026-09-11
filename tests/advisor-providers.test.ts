import test from "node:test";
import assert from "node:assert/strict";
import { callAdvisor, advisorProviderStatus } from "../server/advisor-providers.ts";
import { defaultAdvisorProvider } from "../domain/advisor-providers.ts";
import { Miniflare } from "miniflare";
const env = { GOOGLE_GEMINI_API_KEY: "fixture-google-key", GOOGLE_GEMINI_PAID_SERVICE_CONFIRMED: "true", OPENAI_API_KEY: "fixture-openai-key" };
test("unverified Gemini and missing providers never receive evidence", async () => {
  let calls = 0;
  const request = (async () => { calls++; return Response.json({}); }) as typeof fetch;
  assert.equal(advisorProviderStatus({GOOGLE_GEMINI_API_KEY: "present"}).gemini.ready, false);
  assert.equal((await callAdvisor("gemini", "private evidence", {GOOGLE_GEMINI_API_KEY: "present"}, request)).configured, false);
  assert.equal((await callAdvisor("both", "private evidence", {...env, OPENAI_API_KEY: undefined}, request)).configured, false);
  assert.equal(calls, 0);
});
test("both providers get the same evidence only through protected server requests", async () => {
  const calls: Array<{url: string; init: RequestInit}> = [];
  const request = (async (url, init) => {
    calls.push({url: String(url), init: init!});
    if (String(url).includes("googleapis.com")) return Response.json({candidates:[{finishReason:"STOP",content:{parts:[{thought:true,text:"hidden reasoning"},{text:"Google analysis"}]}}]});
    return Response.json({status:"completed",output:[{type:"reasoning",content:[{type:"output_text",text:"hidden reasoning"}]},{type:"message",content:[{type:"output_text",text:"OpenAI analysis"}]}]});
  }) as typeof fetch;
  const result = await callAdvisor("both", "approved evidence", env, request);
  assert.equal(result.configured, true); assert.deepEqual(result.providers,["gemini","openai"]);
  assert.match(result.text,/Google Gemini\nGoogle analysis/); assert.match(result.text,/OpenAI\nOpenAI analysis/); assert.doesNotMatch(result.text,/hidden reasoning/);
  const google=calls.find(call=>call.url.includes("googleapis.com"))!, openai=calls.find(call=>call.url.includes("openai.com"))!;
  assert.equal(new Headers(google.init.headers).get("x-goog-api-key"),env.GOOGLE_GEMINI_API_KEY);
  assert.equal(new Headers(openai.init.headers).get("authorization"),`Bearer ${env.OPENAI_API_KEY}`);
  const googleBody=JSON.parse(String(google.init.body)), openaiBody=JSON.parse(String(openai.init.body));
  assert.equal(openaiBody.input,googleBody.contents[0].parts[0].text);
  assert.equal(openaiBody.instructions, googleBody.systemInstruction.parts[0].text);
  assert.match(openaiBody.instructions, /Risk analysis:|Marketing:|Finance:/);
  assert.doesNotMatch(openaiBody.instructions, /approved evidence/);
  assert.equal(openaiBody.store,false); assert.equal(openaiBody.tools,undefined);
  for(const call of calls){ assert.equal(call.init.redirect,"manual"); assert.ok(call.init.signal); assert.doesNotMatch(call.url,/fixture/); }
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
      return String(url).includes("googleapis.com")
        ? Response.json({candidates:[{finishReason:"STOP",content:{parts:[{text:"Runtime verified"}]}}]})
        : Response.json({status:"completed",output:[{type:"message",content:[{type:"output_text",text:"Runtime verified"}]}]});
    }) as typeof fetch;
    const result = await callAdvisor("both", "Fictional runtime test", env, request);
    assert.deepEqual(result.providers, ["gemini", "openai"]);
  } finally {
    await runtime.dispose();
  }
});
test("provider redirects fail closed without following or exposing a new destination", async () => {
  for (const provider of ["openai", "gemini"] as const) {
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
test("a partial comparison names the failed provider and never pretends both answered", async () => {
  const request=(async url=>String(url).includes("googleapis.com")?new Response("secret provider diagnostics",{status:503}):Response.json({status:"completed",output:[{type:"message",content:[{type:"output_text",text:"One completed answer"}]}]})) as typeof fetch;
  const result=await callAdvisor("both","evidence",env,request);
  assert.equal(result.configured && result.partial,true); assert.deepEqual(result.providers,["openai"]);
  assert.match(result.text,/Google Gemini\nAnalysis unavailable/); assert.doesNotMatch(result.text,/secret provider/);
});
test("incomplete or empty OpenAI output fails safely without retrying another provider", async () => {
  let calls=0;
  const request=(async()=>{calls++;return Response.json({status:"incomplete",output:[{type:"message",content:[{type:"output_text",text:"Partial financial calculation"}]}]});}) as typeof fetch;
  await assert.rejects(callAdvisor("openai","evidence",env,request),/could not complete/); assert.equal(calls,1);
});

test("initial provider selection prefers an available provider and never silently sends to both", () => {
  assert.equal(defaultAdvisorProvider({openai:{ready:true},gemini:{ready:false}}), "openai");
  assert.equal(defaultAdvisorProvider({openai:{ready:false},gemini:{ready:true}}), "gemini");
  assert.equal(defaultAdvisorProvider({openai:{ready:true},gemini:{ready:true}}), "openai");
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
