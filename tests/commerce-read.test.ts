import assert from "node:assert/strict";
import test from "node:test";
import { CommerceReadError, COMMERCE_READ_TIMEOUT_MS, createCommerceReportLoader, readCommerceJson, type CommerceReportState } from "../app/commerce-read";

const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test("the complete read deadline covers stalled session lookup and stalled response body", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const stage of ["session", "body"]) {
    let calls = 0; let signal!: AbortSignal;
    const pending = readCommerceJson(async (_path, init) => {
      calls++; signal = init!.signal!;
      return stage === "session" ? new Promise<Response>(() => {}) : new Response(new ReadableStream({ start() {} }));
    }, "/report", new AbortController().signal);
    const rejected = assert.rejects(pending, /taking longer than expected/);
    await flush(); t.mock.timers.tick(COMMERCE_READ_TIMEOUT_MS - 1); await flush();
    assert.equal(signal.aborted, false);
    t.mock.timers.tick(1); await rejected;
    assert.equal(signal.aborted, true); assert.equal(calls, 1);
  }
});

test("a legitimate 70-second complete report succeeds before the 120-second deadline", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const states: CommerceReportState<{ cents: number }>[] = [];
  const loader = createCommerceReportLoader<{ cents: number }>(() => new Promise(resolve => setTimeout(() => resolve(Response.json({ cents: -5999 })), 70_000)), state => states.push(state));
  const pending = loader.load("/report");
  t.mock.timers.tick(69_999); await flush(); assert.equal(states.at(-1)?.loading, true);
  t.mock.timers.tick(1); await pending;
  assert.deepEqual(states.at(-1), { scope: "/report", data: { cents: -5999 }, error: "", loading: false });
});

test("replacing scope cancels an old read and ignores its late success or error", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const outcome of ["success", "failure"]) {
    const old = deferred<Response>(); const states: CommerceReportState<{ scope: string }>[] = [];
    let oldSignal!: AbortSignal;
    const loader = createCommerceReportLoader<{ scope: string }>((path, init) => {
      if (path === "/old") { oldSignal = init!.signal!; return old.promise; }
      return Promise.resolve(Response.json({ scope: "new" }));
    }, state => states.push(state));
    const first = loader.load("/old"); await loader.load("/new"); await first;
    assert.equal(oldSignal.aborted, true);
    const before = JSON.stringify(states);
    if (outcome === "success") old.resolve(Response.json({ scope: "private old location" })); else old.reject(new TypeError("Old network failure"));
    await flush(); t.mock.timers.tick(COMMERCE_READ_TIMEOUT_MS); await flush();
    assert.equal(JSON.stringify(states), before);
    assert.equal(states.at(-1)?.data?.scope, "new");
  }
});

test("unmount cancellation releases a stalled wait without posting an error or later busy update", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const states: CommerceReportState<unknown>[] = [];
  const loader = createCommerceReportLoader(() => new Promise<Response>(() => {}), state => states.push(state));
  const pending = loader.load("/report"); loader.cancel(); await pending;
  t.mock.timers.tick(COMMERCE_READ_TIMEOUT_MS * 2); await flush();
  assert.equal(states.length, 1); assert.equal(states[0].loading, true); assert.equal(states[0].error, "");
});

test("timeout ends busy state, waits for manual retry and clears the prior error at retry start", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0; const states: CommerceReportState<{ rows: never[] }>[] = [];
  const loader = createCommerceReportLoader<{ rows: never[] }>(() => ++calls === 1 ? new Promise<Response>(() => {}) : Promise.resolve(Response.json({ rows: [] })), state => states.push(state));
  const first = loader.load("/report"); t.mock.timers.tick(COMMERCE_READ_TIMEOUT_MS); await first;
  assert.equal(states.at(-1)?.loading, false); assert.match(states.at(-1)!.error, /taking longer/);
  t.mock.timers.tick(COMMERCE_READ_TIMEOUT_MS * 2); await flush(); assert.equal(calls, 1);
  const retry = loader.load("/report");
  assert.deepEqual(states.at(-1), { scope: "/report", data: null, error: "", loading: true });
  await retry; assert.equal(calls, 2);
  assert.deepEqual(states.at(-1)?.data, { rows: [] }); assert.equal(states.at(-1)?.error, "");
});

test("401, 402 and 403 clear previously loaded records even for a non-JSON host response", async () => {
  for (const status of [401, 402, 403]) for (const json of [false, true]) {
    let denied = false; let state!: CommerceReportState<{ secret: string }>;
    const fetcher = async () => denied ? json ? Response.json({ error: { message: "Access changed" } }, { status }) : new Response("Gateway access response", { status }) : Response.json({ secret: "authorized earlier" });
    const loader = createCommerceReportLoader<{ secret: string }>(fetcher, next => { state = next; });
    await loader.load("/report"); assert.equal(state.data?.secret, "authorized earlier");
    denied = true; await loader.load("/report");
    assert.equal(state.data, null); assert.equal(state.loading, false); assert.ok(state.error);
    await assert.rejects(readCommerceJson(fetcher, "/report", new AbortController().signal), error => error instanceof CommerceReadError && error.status === status);
  }
});

test("an already aborted scope does not start a request and stays distinct from timeout", async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(readCommerceJson(async () => { calls++; return Response.json({}); }, "/report", controller.signal), { name: "AbortError" });
  assert.equal(calls, 0);
});

test("a late callback from an old scope cannot start another read or cancel the current view", async () => {
  const displayedScope = { value: "/new" }; const current = deferred<Response>(); let calls = 0;
  const states: CommerceReportState<unknown>[] = [];
  const loader = createCommerceReportLoader(() => { calls++; return current.promise; }, state => states.push(state));
  const pending = loader.load("/new", () => displayedScope.value === "/new");
  await loader.load("/old", () => displayedScope.value === "/old");
  assert.equal(calls, 1);
  current.resolve(Response.json({ location: "new" })); await pending;
  assert.deepEqual(states.at(-1)?.data, { location: "new" });
});
