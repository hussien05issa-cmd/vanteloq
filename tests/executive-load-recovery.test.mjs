import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";
import * as preferences from "../domain/dashboard-preferences.ts";
import * as personalization from "../domain/dashboard-personalization.ts";
import * as drafts from "../domain/dashboard-draft.ts";
import * as presentation from "../domain/executive-presentation.ts";

const source = await readFile(new URL("../app/executive-overview.tsx", import.meta.url), "utf8");
const { code } = await transform(source, { loader: "tsx", format: "cjs", jsx: "automatic", target: "es2022" });

// Execute the actual component and effect bodies, including dependency changes,
// cancellation and promise settlement. This is not a browser layout fixture.
function fixture() {
  const slots = [], timers = new Map(), requests = [], intervalCallbacks = [];
  let cursor = 0, dirty = false, nextTimer = 0, tree, props = { currency: "CAD", compact: true, navigate: () => {} };
  let clock = Date.now();
  class ClockDate extends Date { static now() { return clock; } }
  let scheduledEffects = [];
  const jsx = (type, props) => ({ type, props });
  const react = {
    useId: () => "fixture-id",
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, value => {
        const next = typeof value === "function" ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useRef(current) { const index = cursor++; return slots[index] ??= { current }; },
    useEffect(run, dependencies) {
      const index = cursor++, previous = slots[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        slots[index] = { dependencies, cleanup: previous?.cleanup };
        scheduledEffects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = run(); });
      }
    },
  };
  const window = Object.assign(new EventTarget(), {
    setInterval(callback) { intervalCallbacks.push(callback); return intervalCallbacks.length; }, clearInterval() {},
    location: { hash: "", pathname: "/", search: "" }, history: { replaceState() {} },
  });
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const modules = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "../domain/dashboard-preferences": preferences, "../domain/dashboard-personalization": personalization,
    "../domain/dashboard-draft": drafts, "../domain/executive-presentation": presentation,
    "../shared/advisor-limits": { ADVISOR_QUESTION_LIMIT: 8000 },
    "./use-motion-preference": { useMotionPreference: () => false },
    "./supabase-browser": { apiFetch(url, init) {
      if (url === "/api/v1/preferences") return new Promise(() => {});
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      requests.push({ url, init, resolve }); return promise;
    } },
  };
  const named = { "./workspace-skeleton": "WorkspaceSkeleton", "./executive-status-frame": "ExecutiveStatusFrame", "./expanding-surface": "ExpandingSurface" };
  const evaluatedModule = { exports: {} };
  vm.runInNewContext(code, { module: evaluatedModule, exports: evaluatedModule.exports, require(name) {
    if (modules[name]) return modules[name];
    if (name.endsWith(".css")) return {};
    assert.ok(name.startsWith("./"), `Unexpected import ${name}`);
    return { __esModule: true, default: named[name] ?? name, MetricSparkline: "MetricSparkline" };
  }, window, document, URLSearchParams, AbortController, Error, Date: ClockDate, Intl, Map, queueMicrotask,
    setTimeout(callback, milliseconds) { const id = ++nextTimer; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  function render(next = {}) {
    props = { ...props, ...next }; cursor = 0; dirty = false; scheduledEffects = [];
    tree = evaluatedModule.exports.default(props); for (const run of scheduledEffects) run();
  }
  function nodes(predicate, node, found = []) {
    if (Array.isArray(node)) { for (const child of node) nodes(predicate, child, found); return found; }
    if (!node || typeof node !== "object") return found;
    if (predicate(node)) found.push(node); nodes(predicate, node.props?.children, found); return found;
  }
  return {
    requests, render, nodes: predicate => nodes(predicate, tree),
    async flush() { for (let iteration = 0; iteration < 12; iteration++) { await Promise.resolve(); if (dirty) render(); } },
    deadline() { const entry = [...timers.entries()].find(([, timer]) => timer.milliseconds === 30000); assert.ok(entry); timers.delete(entry[0]); entry[1].callback(); },
    refresh() { assert.equal(intervalCallbacks.length, 1); intervalCallbacks[0](); },
    advance(milliseconds) { clock += milliseconds; },
    focus() { window.dispatchEvent(new Event("focus")); },
    retry() { const gate = nodes(node => node.type === "ExecutiveStatusFrame", tree)[0]; assert.ok(gate); gate.props.onRetry(); },
    close() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
const noSkeleton = f => assert.equal(f.nodes(node => node.type === "WorkspaceSkeleton").length, 0);
const report = { period: { from: "2026-10-01", to: "2026-10-10" }, metrics: [], insights: [], sourceCoverage: false };

test("a nonsettling transport exits loading at the deadline and late data cannot restore its snapshot", async t => {
  const f = fixture(); t.after(() => f.close()); f.render(); await f.flush();
  assert.equal(f.requests.length, 1); assert.equal(f.nodes(node => node.type === "WorkspaceSkeleton").length, 1);
  f.deadline(); await f.flush(); noSkeleton(f);
  assert.equal(f.requests[0].init.signal.aborted, true);
  assert.equal(f.nodes(node => node.props?.className === "executive-error").length, 1);
  assert.equal(f.nodes(node => node.type === "button" && node.props.children === "Refresh")[0].props.disabled, false);
  f.requests[0].resolve(Response.json({ executiveReport: report })); await f.flush(); noSkeleton(f);
  assert.equal(f.nodes(node => node.props?.className === "executive-error").length, 1, "A late success cannot clear a timed-out result");
});

test("completed 409 and 503 responses leave loading and keep source actions during a same-scope retry", async t => {
  for (const [status, errorCode] of [[409, "SALES_SOURCE_CONFLICT"], [503, "SOURCE_SYNCING"]]) {
    const f = fixture(); t.after(() => f.close()); f.render(); await f.flush();
    f.requests[0].resolve(Response.json({ error: { code: errorCode, message: "Review required" } }, { status })); await f.flush();
    noSkeleton(f);
    const gate = f.nodes(node => node.type === "ExecutiveStatusFrame")[0]; assert.ok(gate);
    assert.equal(gate.props.syncing, status === 503); assert.equal(gate.props.checking, false);
    f.retry(); await f.flush(); noSkeleton(f);
    assert.equal(f.requests.length, 2);
    assert.equal(f.nodes(node => node.type === "ExecutiveStatusFrame")[0].props.checking, true);
    f.requests[1].resolve(Response.json({ executiveReport: report })); await f.flush();
    noSkeleton(f); assert.equal(f.nodes(node => node.type === "ExecutiveStatusFrame").length, 0);
    assert.equal(f.nodes(node => node.props?.className === "executive-error").length, 0);
  }
});

test("a stalled response body times out and a later reporting scope ignores the old response", async t => {
  const f = fixture(); t.after(() => f.close()); f.render(); await f.flush();
  let finishBody;
  f.requests[0].resolve({ ok: true, json: () => new Promise(done => { finishBody = done; }) }); await f.flush();
  f.deadline(); await f.flush(); noSkeleton(f);
  f.render({ activeLocationId: "other-authorized-location" }); await f.flush();
  assert.equal(f.nodes(node => node.type === "WorkspaceSkeleton").length, 1);
  assert.equal(f.requests.length, 2); assert.match(f.requests[1].url, /location=other-authorized-location/);
  finishBody({ executiveReport: report }); await f.flush();
  assert.equal(f.nodes(node => node.type === "WorkspaceSkeleton").length, 1);
  f.requests[1].resolve(Response.json({ error: { code: "SALES_SOURCE_CONFLICT", message: "Choose a reporting source" } }, { status: 409 })); await f.flush();
  noSkeleton(f); assert.equal(f.nodes(node => node.type === "ExecutiveStatusFrame")[0].props.message, "Choose a reporting source");
});

test("focus and background polling cannot restart a pending deadline or hide its recovery state", async t => {
  const f = fixture(); t.after(() => f.close()); f.render(); await f.flush();
  f.advance(16000); f.focus(); await f.flush();
  f.advance(60000); f.refresh(); await f.flush();
  assert.equal(f.requests.length, 1, "Automatic checks must coalesce with the pending request");
  assert.equal(f.requests[0].init.signal.aborted, false);
  f.deadline(); await f.flush(); noSkeleton(f);
  f.advance(60000); f.refresh(); await f.flush();
  assert.equal(f.requests.length, 2); noSkeleton(f);
  assert.equal(f.nodes(node => node.props?.className === "executive-error").length, 1);
  assert.equal(f.nodes(node => node.type === "button" && node.props.children === "Checking…")[0].props.disabled, true);
});
