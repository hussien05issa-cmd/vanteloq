import assert from "node:assert/strict";
import test from "node:test";
import { bookloqRequest, bookloqAccessDenied } from "../app/bookloq-request.ts";
import { createDocumentEmailRequests } from "../app/document-email-client.ts";

test("a stalled session or response body stops at the deadline and a fresh retry succeeds", async () => {
  for (const fetcher of [
    () => new Promise<Response>(() => {}),
    async () => new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "application/json" } }),
  ]) {
    await assert.rejects(bookloqRequest(fetcher, "/read", {}, 20), /taking longer/);
  }
  assert.deepEqual(await bookloqRequest(async () => Response.json({ ok: true }), "/read"), { ok: true });
});

test("network errors and non-JSON host errors are readable", async () => {
  await assert.rejects(bookloqRequest(async () => { throw new TypeError("fetch failed"); }, "/read"), /Check your connection/);
  await assert.rejects(bookloqRequest(async () => new Response("<html>502</html>", { status: 502 }), "/read"), /could not be reached/);
  await assert.rejects(bookloqRequest(async () => Response.json({ error: { message: "Your role cannot view this record." } }, { status: 403 }), "/read"), /Your role cannot/);
});

test("an uncertain financial write is never automatically retried", async () => {
  for (const outcome of ["network", "html", "timeout"]) {
    let calls = 0;
    await assert.rejects(bookloqRequest(async () => {
      calls++;
      if (outcome === "network") throw new TypeError("connection reset after save");
      if (outcome === "html") return new Response("Gateway error", { status: 502 });
      return new Promise<Response>(() => {});
    }, "/write", { method: "POST", body: "{}" }, 20), /Check the saved records before submitting again/);
    assert.equal(calls, 1);
  }
});

test("a late old-scope response cannot replace current records and cancellation releases the wait", async () => {
  const requests = createDocumentEmailRequests();
  const first = requests.begin();
  let release!: (response: Response) => void;
  let displayed = "new location";
  const old = bookloqRequest(() => new Promise<Response>(resolve => { release = resolve; }), "/old", { signal: first.signal }).then(body => {
    if (first.current()) displayed = body.location;
  });
  const rejected = assert.rejects(old, { name: "AbortError" });
  const second = requests.begin();
  await rejected;
  release(Response.json({ location: "old location" }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(displayed, "new location");
  assert.equal(second.current(), true);
  requests.cancel();
});

test("an already cancelled request is not sent", async () => {
  const cancelled = new AbortController(); cancelled.abort();
  let calls = 0;
  await assert.rejects(bookloqRequest(async () => { calls++; return Response.json({}); }, "/read", { signal: cancelled.signal }), { name: "AbortError" });
  assert.equal(calls, 0);
});

test("access failures retain their status even when the host sends HTML", async () => {
  for (const status of [401, 402, 403, 500]) {
    for (const json of [true, false]) {
      await assert.rejects(bookloqRequest(async () => json ? Response.json({ error: { message: "Access changed" } }, { status }) : new Response("Gateway response", { status }), "/read"), error => {
        assert.equal(bookloqAccessDenied(error), status !== 500);
        return true;
      });
    }
  }
});
