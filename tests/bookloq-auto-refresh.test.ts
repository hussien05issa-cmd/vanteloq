import assert from "node:assert/strict";
import test from "node:test";
import { startBookloqAutoRefresh, type BookloqRefreshState } from "../app/bookloq-auto-refresh.ts";

function setup(refresh?: () => void | Promise<void>) {
  let now = 0, visible = true, calls = 0, timerStops = 0, visibilityStops = 0;
  let tick = () => {}, visibilityChange = () => {};
  const state: BookloqRefreshState = { inFlight: false, hasError: false, lastSuccessfulReadAt: 0 };
  const dispose = startBookloqAutoRefresh({
    getState: () => state,
    refresh: () => { calls += 1; return refresh ? refresh() : void (state.lastSuccessfulReadAt = now); },
    runtime: {
      now: () => now,
      isVisible: () => visible,
      every: (callback, milliseconds) => { assert.equal(milliseconds, 60_000); tick = callback; return () => { timerStops += 1; }; },
      onVisibilityChange: callback => { visibilityChange = callback; return () => { visibilityStops += 1; }; },
    },
  });
  return {
    state, dispose,
    time: (value: number) => { now = value; },
    tick: () => tick(),
    visibility: (value: boolean) => { visible = value; visibilityChange(); },
    counts: () => ({ calls, timerStops, visibilityStops }),
  };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test("visible polling waits 60 seconds after a successful read and makes no initial request", async () => {
  const f = setup();
  assert.equal(f.counts().calls, 0);
  f.time(59_999); f.tick(); assert.equal(f.counts().calls, 0);
  f.time(60_000); f.tick(); await settle(); assert.equal(f.counts().calls, 1);
  f.time(119_999); f.tick(); assert.equal(f.counts().calls, 1);
  f.time(120_000); f.tick(); await settle(); assert.equal(f.counts().calls, 2);
  f.dispose();
});

test("hidden tabs do not poll and return to visible refreshes only after 15 seconds", async () => {
  const f = setup();
  f.visibility(false);
  f.time(60_000); f.tick(); f.time(120_000); f.tick(); assert.equal(f.counts().calls, 0);
  f.visibility(true); await settle(); assert.equal(f.counts().calls, 1);
  f.visibility(false); f.time(134_999); f.visibility(true); assert.equal(f.counts().calls, 1);
  f.visibility(false); f.time(135_000); f.visibility(true); await settle(); assert.equal(f.counts().calls, 2);
  f.dispose();
});

test("initial reads, current errors and existing manual requests prevent automatic reads", async () => {
  const f = setup(); f.time(60_000);
  f.state.lastSuccessfulReadAt = null; f.tick(); assert.equal(f.counts().calls, 0);
  f.state.lastSuccessfulReadAt = 0; f.state.inFlight = true; f.tick(); f.visibility(true); assert.equal(f.counts().calls, 0);
  f.state.inFlight = false; f.state.hasError = true; f.tick(); f.visibility(true); assert.equal(f.counts().calls, 0);
  f.state.hasError = false; f.state.lastSuccessfulReadAt = 60_000;
  f.time(120_000); f.tick(); await settle(); assert.equal(f.counts().calls, 1);
  f.dispose();
});

test("slow automatic reads cannot overlap even before caller state has updated", async () => {
  let finish!: () => void;
  const f = setup(() => new Promise<void>(resolve => { finish = resolve; }));
  f.time(60_000); f.tick(); assert.equal(f.counts().calls, 1);
  f.time(120_000); f.tick(); f.visibility(false); f.visibility(true); assert.equal(f.counts().calls, 1);
  f.state.lastSuccessfulReadAt = 120_000; finish(); await settle();
  f.time(180_000); f.tick(); assert.equal(f.counts().calls, 2);
  f.dispose(); finish(); await settle();
});

test("handled refresh errors or access denial pause automatic reads until manual recovery", async () => {
  const f = setup(() => { f.state.hasError = true; });
  f.time(60_000); f.tick(); await settle();
  f.time(120_000); f.tick(); f.visibility(false); f.visibility(true); assert.equal(f.counts().calls, 1);
  f.state.hasError = false; f.state.lastSuccessfulReadAt = 120_000;
  f.time(180_000); f.tick(); await settle(); assert.equal(f.counts().calls, 2);
  f.dispose();
});

test("thrown and rejected refreshes do not retry without a newer successful read", async t => {
  for (const mode of ["throw", "reject"] as const) await t.test(mode, async () => {
    const f = setup(() => { if (mode === "throw") throw new Error("read unavailable"); return Promise.reject(new Error("read unavailable")); });
    f.time(60_000); f.tick(); await settle();
    f.time(120_000); f.tick(); f.visibility(false); f.visibility(true); await settle(); assert.equal(f.counts().calls, 1);
    f.state.lastSuccessfulReadAt = 120_000;
    f.time(180_000); f.tick(); await settle(); assert.equal(f.counts().calls, 2);
    f.dispose();
  });
});

test("unmount clears both subscriptions once and suppresses stale callbacks after a pending read", async () => {
  let finish!: () => void;
  const f = setup(() => new Promise<void>(resolve => { finish = resolve; }));
  f.time(60_000); f.tick();
  f.dispose(); f.dispose();
  finish(); await settle();
  f.time(120_000); f.tick(); f.visibility(false); f.visibility(true);
  assert.deepEqual(f.counts(), { calls: 1, timerStops: 1, visibilityStops: 1 });
});

test("invalid or backwards clocks do not cause premature reads", () => {
  const f = setup();
  f.time(-60_000); f.tick(); f.visibility(true);
  f.time(Number.POSITIVE_INFINITY); f.tick();
  f.state.lastSuccessfulReadAt = Number.NaN; f.time(60_000); f.tick();
  assert.equal(f.counts().calls, 0); f.dispose();
});
