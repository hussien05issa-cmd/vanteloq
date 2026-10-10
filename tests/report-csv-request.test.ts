import assert from "node:assert/strict";
import test from "node:test";
import { reportCsvRequest, ReportCsvRequestError } from "../app/report-csv-request.ts";

test("CSV deadline releases a stalled session/fetch and allows a fresh retry", async () => {
  let calls = 0;
  await assert.rejects(reportCsvRequest(() => { calls++; return new Promise<Response>(() => {}); }, "/report", {}, 20), /taking longer than expected/);
  assert.equal(calls, 1, "Read timeouts never initiate an automatic retry");
  const blob = await reportCsvRequest(async () => new Response("Amount cents\r\n12345", { headers: { "Content-Type": "text/csv;charset=utf-8" } }), "/report");
  assert.equal(await blob.text(), "Amount cents\r\n12345");
});

test("CSV deadline covers a stalled blob and a stalled server error body", async () => {
  for (const status of [200, 403]) {
    const response = new Response(new ReadableStream({ start() {} }), { status, headers: { "Content-Type": status === 200 ? "text/csv" : "application/json" } });
    await assert.rejects(reportCsvRequest(async () => response, "/report", {}, 20), /taking longer than expected/);
  }
});

test("scope cancellation releases a hung export and a late response cannot produce its blob", async () => {
  const scope = new AbortController();
  let release!: (response: Response) => void, returned = false;
  const promise = reportCsvRequest(() => new Promise<Response>(resolve => { release = resolve; }), "/old-business", { signal: scope.signal }).then(() => { returned = true; });
  const rejected = assert.rejects(promise, { name: "AbortError" });
  scope.abort();
  await rejected;
  release(new Response("Old business", { headers: { "Content-Type": "text/csv" } }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(returned, false);
  let calls = 0;
  await assert.rejects(reportCsvRequest(async () => { calls++; return new Response(); }, "/report", { signal: scope.signal }), { name: "AbortError" });
  assert.equal(calls, 0, "An already cancelled scope never sends a request");
});

test("CSV requests preserve caller headers and are always read only", async () => {
  const blob = await reportCsvRequest(async (path, init) => {
    assert.equal(path, "/report?workspace=authorized");
    assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("X-Vanteloq-Workspace"), "authorized"); assert.equal(headers.get("Accept"), "text/csv");
    assert.equal(init?.cache, "no-store"); assert.ok(init?.signal);
    return new Response("a,b\r\n1,2", { headers: { "Content-Type": "text/csv; charset=utf-8" } });
  }, "/report?workspace=authorized", { headers: { "X-Vanteloq-Workspace": "authorized" } });
  assert.equal(await blob.text(), "a,b\r\n1,2");
});

test("non-CSV, server and network errors remain actionable without downloading an error document", async () => {
  for (const contentType of ["text/html", "application/json", "text/csv-invalid", ""]) {
    await assert.rejects(reportCsvRequest(async () => new Response("Not a CSV", { headers: { "Content-Type": contentType } }), "/report"), /did not return a CSV/);
  }
  await assert.rejects(reportCsvRequest(async () => Response.json({ error: { message: "Your role cannot export financial reports." } }, { status: 403 }), "/report"), error => {
    assert.ok(error instanceof ReportCsvRequestError); assert.equal(error.status, 403); assert.match(error.message, /Your role cannot export/); return true;
  });
  await assert.rejects(reportCsvRequest(async () => new Response("<html>Unavailable</html>", { status: 502 }), "/report"), /could not be exported/);
  await assert.rejects(reportCsvRequest(async () => { throw new TypeError("fetch failed"); }, "/report"), /Check your connection/);
});
