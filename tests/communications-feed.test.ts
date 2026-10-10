import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CommunicationsWorkspace from "../app/communications-workspace.tsx";
import { CommunicationsReadError, createCommunicationsFeed, readCommunicationsFeed, visibleCommunicationsSnapshot, type CommunicationsSnapshot, type OperationalEvent, type OperationsFeed } from "../app/communications-feed.ts";
import { operationsFeedWindow } from "../server/operations.ts";

const event = (id: string, recordedAt = 10): OperationalEvent => ({ id, eventType: "message.queued", aggregateType: "message", aggregateId: id, sourceSystem: "manual", occurredAt: recordedAt, recordedAt, payload: {} });
const fingerprint = "a".repeat(64);
const feed = (cursor: number, events: OperationalEvent[] = [event(`event-${cursor}`)], scopeFingerprint = fingerprint): OperationsFeed => ({ scopeFingerprint, cursor, events,
  messages: [{ id: `message-${cursor}`, channel: "email", recipient: "fixture@example.invalid", subject: `Message ${cursor}`, status: "held", attemptCount: 0, createdAt: cursor, updatedAt: cursor }],
  inventory: [{ locationRef: "fixture", sku: "sku", name: "Fixture item", projectedQuantity: cursor, reorderPoint: 1, updatedAt: cursor }] });

function setup(locationId: string | null = "north", onChange?: (state: CommunicationsSnapshot) => void) {
  const states: CommunicationsSnapshot[] = [];
  const requests: { after: number; signal: AbortSignal; scopeFingerprint: string | null; resolve: (body: OperationsFeed) => void; reject: (error: Error) => void }[] = [];
  let tick = () => {}, timerStops = 0, now = 1000;
  const source = createCommunicationsFeed({ locationId, now: () => now,
    onChange: state => { states.push(state); onChange?.(state); },
    read: (after, signal, scopeFingerprint) => new Promise((resolve, reject) => { requests.push({ after, signal, scopeFingerprint, resolve, reject }); }),
    every: (callback, milliseconds) => { assert.equal(milliseconds, 8000); tick = callback; return () => { timerStops++; }; },
  });
  return { source, requests, states, tick: () => tick(), time: (value: number) => { now = value; }, latest: () => states.at(-1)!, stops: () => timerStops };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test("initial workspace renders loading rather than successful zero counts or a live claim", () => {
  const html = renderToStaticMarkup(createElement(CommunicationsWorkspace, { activeLocationId: "north" }));
  assert.match(html, /Loading operational feed/);
  assert.match(html, /No successful read for this scope yet/);
  assert.equal((html.match(/<b>Not available<\/b>/g) ?? []).length, 3);
  assert.doesNotMatch(html, /Live operational feed|No projected stock risk|No operational events recorded|No messages match this view/);
});

test("manual retries and polling serialize slow reads and merge event identities once", async () => {
  const f = setup();
  const first = f.source.refresh();
  f.tick(); await f.source.refresh(); f.tick();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].after, 0);
  assert.equal(f.requests[0].scopeFingerprint, null);
  assert.equal(f.latest().refreshing, true);
  f.requests[0].resolve(feed(10, [event("first"), event("repeat")])); await first;
  f.tick();
  assert.equal(f.requests[1].after, 10);
  assert.equal(f.requests[1].scopeFingerprint, fingerprint);
  f.requests[1].resolve(feed(20, [event("repeat", 20), event("next", 20)])); await settle();
  assert.deepEqual(f.latest().feed?.events.map(item => item.id), ["first", "repeat", "next"]);
  assert.equal(f.latest().feed?.events[1].recordedAt, 20);
  assert.deepEqual(f.latest().feed?.messages.map(item => item.id), ["message-20"], "message and inventory snapshots replace earlier status");
  assert.equal(f.latest().feed?.inventory[0].projectedQuantity, 20);
  f.source.dispose();
});

test("failed background reads retain a labelled snapshot and recover using the last confirmed cursor", async () => {
  const f = setup();
  const first = f.source.refresh(); f.requests[0].resolve(feed(10)); await first;
  f.time(2000); f.tick(); f.requests[1].reject(Error("Connection interrupted")); await settle();
  assert.equal(f.latest().error, "Connection interrupted");
  assert.equal(f.latest().refreshing, false);
  assert.equal(f.latest().feed?.cursor, 10);
  assert.equal(f.latest().lastSuccessfulReadAt, 1000);
  f.time(3000); const retry = f.source.refresh();
  assert.equal(f.requests[2].after, 10);
  assert.equal(f.latest().error, "Connection interrupted", "starting retry does not certify a fresh snapshot");
  f.requests[2].resolve(feed(30)); await retry;
  assert.equal(f.latest().error, "");
  assert.equal(f.latest().lastSuccessfulReadAt, 3000);
  assert.equal(f.latest().feed?.cursor, 30);
  f.source.dispose();
});

test("location changes hide the old snapshot immediately and ignore late parsing after abort", async () => {
  let snapshot: CommunicationsSnapshot | null = null;
  const north = setup("north", state => { snapshot = state; });
  const first = north.source.refresh(); north.requests[0].resolve(feed(10)); await first;
  const oldRefresh = north.source.refresh();
  const hidden = visibleCommunicationsSnapshot(snapshot, "south");
  assert.equal(hidden.feed, null);
  assert.equal(hidden.refreshing, true);
  assert.equal(hidden.lastSuccessfulReadAt, null);
  north.source.dispose();
  assert.equal(north.requests[1].signal.aborted, true);
  const south = setup("south", state => { snapshot = state; });
  const newRefresh = south.source.refresh();
  assert.equal(south.requests[0].after, 0);
  south.requests[0].resolve(feed(20)); await newRefresh;
  north.requests[1].resolve(feed(999)); await oldRefresh;
  assert.equal(visibleCommunicationsSnapshot(snapshot, "south").feed?.cursor, 20);
  assert.equal(visibleCommunicationsSnapshot(snapshot, null).feed, null, "whole-workspace scope is also separate");
  south.source.dispose();
});

test("unmount aborts, clears polling once and suppresses late success or failure", async () => {
  for (const outcome of ["success", "failure"]) {
    const f = setup(); const read = f.source.refresh(); const changes = f.states.length;
    f.source.dispose(); f.source.dispose(); f.tick(); await f.source.refresh();
    assert.equal(f.stops(), 1); assert.equal(f.requests.length, 1); assert.equal(f.requests[0].signal.aborted, true);
    if (outcome === "success") f.requests[0].resolve(feed(10)); else f.requests[0].reject(Error("late failure"));
    await read;
    assert.equal(f.states.length, changes);
  }
});

test("access denial removes cached messages and restarts recovery without a stale cursor", async () => {
  for (const status of [401, 403]) {
    const f = setup(); const first = f.source.refresh(); f.requests[0].resolve(feed(10)); await first;
    const denied = f.source.refresh(); f.requests[1].reject(new CommunicationsReadError("Access changed", status)); await denied;
    assert.equal(f.latest().feed, null);
    assert.equal(f.latest().error, "Access changed");
    const retry = f.source.refresh(); assert.equal(f.requests[2].after, 0);
    f.requests[2].resolve(feed(20)); await retry; f.source.dispose();
  }
});

test("retained event history stays bounded across successful polls", async () => {
  const f = setup();
  const first = f.source.refresh(); f.requests[0].resolve(feed(200, Array.from({ length: 200 }, (_, i) => event(String(i))))); await first;
  const next = f.source.refresh(); f.requests[1].resolve(feed(400, Array.from({ length: 200 }, (_, i) => event(String(200 + i))))); await next;
  assert.equal(f.latest().feed?.events.length, 300);
  assert.equal(f.latest().feed?.events[0].id, "100");
  assert.equal(f.latest().feed?.events.at(-1)?.id, "399");
  f.source.dispose();
});

test("feed request preserves scope and abort signal and rejects incomplete or unauthorized responses", async () => {
  const signal = new AbortController().signal;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "https://example.invalid");
    assert.equal(url.pathname, "/api/v1/operations"); assert.equal(url.searchParams.get("after"), "10");
    assert.equal(url.searchParams.get("location"), "north & west"); assert.equal(init?.signal, signal);
    assert.equal(url.searchParams.get("scope"), fingerprint);
    return Response.json(feed(20));
  };
  assert.equal((await readCommunicationsFeed(fetcher, "north & west", 10, signal, fingerprint)).cursor, 20);
  for (const body of [null, {}, { ...feed(20), messages: null }, { ...feed(20), scopeFingerprint: undefined }, { ...feed(20), scopeFingerprint: "invalid" }, feed(9)]) {
    await assert.rejects(readCommunicationsFeed(async () => Response.json(body), null, 10, signal, fingerprint), /incomplete response/);
  }
  await assert.rejects(readCommunicationsFeed(async () => new Response("Session expired", { status: 401 }), null, 0, signal), (error: unknown) => error instanceof CommunicationsReadError && error.status === 401);
});

test("a successful narrower all-locations response discards old events and restarts at its authorized cursor", async () => {
  const base = { organizationId: "fixture-organization", accessibleLocationIds: ["north", "south"], selectedLocationId: null, locationIds: null, locationRefs: null };
  const narrower = { ...base, accessibleLocationIds: ["north"], locationIds: ["north"], locationRefs: ["north"] };
  let scope: Parameters<typeof operationsFeedWindow>[0] = base;
  let state: CommunicationsSnapshot | null = null;
  const observed: { after: number; requestedScope: string | null }[] = [];
  const fetcher: typeof fetch = async input => {
    const query = new URL(String(input), "https://example.invalid").searchParams;
    const window = await operationsFeedWindow(scope, query.get("scope"), Number(query.get("after")));
    observed.push({ after: window.after, requestedScope: query.get("scope") });
    const events = scope === base ? [event("private-south", 100), event("permitted-north", 5)] : [event("permitted-north", 5)];
    return Response.json(feed(scope === base ? 100 : 5, events, window.scopeFingerprint));
  };
  const controller = createCommunicationsFeed({ locationId: null, now: () => 1000, every: () => () => {},
    read: (after, signal, scopeFingerprint) => readCommunicationsFeed(fetcher, null, after, signal, scopeFingerprint),
    onChange: snapshot => { state = snapshot; },
  });
  await controller.refresh();
  assert.deepEqual(visibleCommunicationsSnapshot(state, null).feed?.events.map(item => item.id), ["private-south", "permitted-north"]);
  scope = narrower;
  await controller.refresh();
  assert.deepEqual(observed.map(item => item.after), [0, 0], "the old scope's cursor must not skip authorized earlier records");
  assert.deepEqual(visibleCommunicationsSnapshot(state, null).feed?.events.map(item => item.id), ["permitted-north"]);
  assert.equal(visibleCommunicationsSnapshot(state, null).feed?.cursor, 5);
  assert.equal(visibleCommunicationsSnapshot(state, null).error, "", "a valid changed-scope cursor may be lower");
  await controller.refresh();
  assert.equal(observed[2].after, 5);
  assert.notEqual(observed[1].requestedScope, observed[2].requestedScope);
  controller.dispose();
});
