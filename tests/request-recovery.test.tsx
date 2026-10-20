import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import PageRecovery from "../app/error";
import NotFound from "../app/not-found";
import { recoverApiResponse, safeRequestMessage } from "../app/request-recovery";

test("gateway HTML becomes usable JSON guidance without changing the failure status or replaying a write", async () => {
  const original = new Response("<html><h1>502 Bad Gateway</h1><p>upstream internal-name</p></html>", { status: 502, headers: { "Content-Type": "text/html", "Content-Length": "92", "X-Request-Id": "fixture-reference" } });
  const result = await recoverApiResponse(original, true);
  assert.equal(result.status, 502);
  assert.equal(result.headers.get("X-Request-Id"), "fixture-reference");
  assert.equal(result.headers.get("Content-Length"), null);
  assert.match((await result.json()).error.message, /Check the saved records before trying again/);
  assert.match(await original.text(), /upstream internal-name/);
});

test("valid permission and field guidance, machine error codes and session-expired semantics remain intact", async () => {
  for (const item of [
    { status: 401, code: "SESSION_EXPIRED", message: "Sign in to continue." },
    { status: 400, code: "UNBALANCED_JOURNAL", message: "Debit and credit totals must match before posting." },
    { status: 403, code: "PERMISSION_REQUIRED", message: "Ask your workspace owner for invoice access." },
  ]) {
    const original = Response.json({ error: { code: item.code, message: item.message }, requestId: "request-fixture" }, { status: item.status });
    assert.equal(await recoverApiResponse(original, true), original);
    assert.deepEqual(await original.json(), { error: { code: item.code, message: item.message }, requestId: "request-fixture" });
  }
});

test("bare errors and technical diagnostics do not become customer copy", async () => {
  for (const message of ["404", "HTTP 500 error", "502 Bad Gateway", "D1_ERROR: no such table: private_entries", "TypeError: Cannot read properties", "Unexpected token '<', invalid JSON", "The request could not be completed."]) {
    assert.equal(safeRequestMessage(message, "Please try again."), "Please try again.");
  }
  assert.equal(safeRequestMessage("You can add up to 500 documents.", "fallback"), "You can add up to 500 documents.");
  const response = await recoverApiResponse(Response.json({ error: { code: "MISSING", message: "404" }, requestId: "safe-id" }, { status: 404 }), false);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: { code: "MISSING", message: "This item is no longer available here. Refresh the list and choose it again." }, requestId: "safe-id" });
});

test("success and bodyless conditional responses pass through without consuming their streams", async () => {
  const pdf = new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "application/pdf" } });
  assert.equal(await recoverApiResponse(pdf, false), pdf);
  assert.equal(pdf.bodyUsed, false);
  const cached = new Response(null, { status: 304 });
  assert.equal(await recoverApiResponse(cached, false), cached);
});

test("page recovery exposes useful actions and no raw exception; missing routes keep useful navigation", () => {
  const html = renderToStaticMarkup(<PageRecovery error={new Error("secret-fixture SQL failure")} reset={() => undefined}/>);
  assert.match(html, /Try again/);
  assert.match(html, /check its status before submitting it again/);
  assert.match(html, /aria-labelledby="page-recovery-title"/);
  assert.match(html, /href="\/contact"/);
  assert.doesNotMatch(html, /secret-fixture|SQL failure|>500</);
  const missing = renderToStaticMarkup(<NotFound/>);
  assert.match(missing, /We couldn’t find this page/);
  assert.match(missing, /Return home/);
  assert.doesNotMatch(missing, />404</);
});
