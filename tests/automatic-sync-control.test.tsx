import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import AutomaticSyncControl, { type AutomaticSyncStatus } from "../app/automatic-sync-control";
import { connectorHealth, type Connector } from "../domain/connector-guidance";

const now = Date.parse("2026-09-25T12:00:00Z");
const old = "2026-09-25T10:00:00Z";
const recent = "2026-09-25T11:55:00Z";
const base: AutomaticSyncStatus = {
  configured: true, healthy: true, canManage: true, enabled: true, status: "completed",
  lastErrorCode: null, nextRunAt: "2026-09-25T10:15:00Z", lastFinishedAt: old, intervalMinutes: 15,
};
function render(changes: Partial<AutomaticSyncStatus> = {}, sourceChanges: Partial<Connector> = {}) {
  const status = { ...base, ...changes };
  const source: Connector = {
    id: "square", name: "Square", category: "Point of sale", availability: "credentials_required",
    status: "connected", dataPromotionStatus: "approved", lastSuccessfulSyncAt: old,
    providerReadiness: { credentialsConfigured: true, mode: "production", liveDataEligible: true },
    ...sourceChanges, automaticSync: status,
  };
  const health = connectorHealth(source, { now });
  return renderToStaticMarkup(<AutomaticSyncControl provider="square" connectionId="fictional-source" accountName="Fictional source"
    status={status} health={health} refresh={async () => {}}/>);
}

test("a completed job cannot claim freshness for overdue source records", context => {
  context.mock.method(Date, "now", () => now);
  const html = render();
  assert.match(html, /data-health-tone="neutral">Last run completed/);
  assert.match(html, /older than the expected refresh window/);
  assert.match(html, /Scheduled check overdue:/);
  assert.match(html, /Last run finished: <time dateTime="2026-09-25T10:00:00\.000Z"/);
  assert.match(html, /2026.*UTC/);
  assert.doesNotMatch(html, /Up to date|Last successful run/);
});

test("current imports still show dated job status and the existing scoped health guidance", context => {
  context.mock.method(Date, "now", () => now);
  const html = render({ lastFinishedAt: recent, nextRunAt: "2026-09-25T12:10:00Z" }, { lastSuccessfulSyncAt: recent });
  assert.match(html, /Last run completed/);
  assert.match(html, /within the expected refresh window/);
  assert.match(html, /Next scheduled check: <time dateTime="2026-09-25T12:10:00\.000Z"/);
  assert.doesNotMatch(html, /Scheduled check overdue|Up to date/);
});

test("invalid or future last-run dates remain unknown instead of producing misleading timestamps", context => {
  context.mock.method(Date, "now", () => now);
  for (const lastFinishedAt of [null, "invalid-date", "2026-09-26T12:00:00Z"]) {
    const html = render({ lastFinishedAt, nextRunAt: "invalid-date" });
    assert.match(html, /Last run time is unavailable/);
    assert.match(html, /Next check time is unavailable/);
    assert.doesNotMatch(html, /Invalid Date|<time|Up to date/);
  }
});

test("timestamps retain the complete date and UTC zone in different device zones", context => {
  context.mock.method(Date, "now", () => now);
  const before = process.env.TZ;
  try {
    const html = ["UTC", "America/Denver", "Asia/Tokyo"].map(zone => {
      process.env.TZ = zone;
      return render();
    });
    assert.equal(html[0], html[1]);
    assert.equal(html[0], html[2]);
    assert.match(html[0], /2026.*UTC/);
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

test("delayed and retrying jobs do not promise a successful or current import", context => {
  context.mock.method(Date, "now", () => now);
  const delayed = render({ healthy: false });
  assert.match(delayed, /background service is delayed/);
  assert.match(delayed, /Automatic updates are delayed or paused/);
  assert.doesNotMatch(delayed, /Up to date|Manual sync remains available/);
  const retry = render({ status: "retrying", lastErrorCode: "SQUARE_RATE_LIMITED" });
  assert.match(retry, /Retry scheduled/);
  assert.match(retry, /updates will retry/);
  assert.match(retry, /Last run finished:/);
  assert.match(retry, /square rate limited/);
  assert.doesNotMatch(retry, /Last successful run|Up to date/);
});

test("reauthorization guides recovery, allows pausing and prevents enabling new imports", context => {
  context.mock.method(Date, "now", () => now);
  const source = { lastErrorCode: "SQUARE_AUTHORIZATION_EXPIRED" };
  const running = render({}, source);
  assert.match(running, /Reconnect this account before automatic or manual imports can resume/);
  assert.match(running, /Pause automatic sync/);
  assert.doesNotMatch(running, /<button[^>]*disabled/);
  const paused = render({ enabled: false, status: "paused" }, source);
  assert.match(paused, /<button[^>]*disabled=""/);
  assert.match(paused, /Reconnect this account before enabling automatic imports/);
  assert.doesNotMatch(paused, /Manual sync remains available/);
});

test("readers retain status visibility without gaining automatic-sync controls", context => {
  context.mock.method(Date, "now", () => now);
  const html = render({ canManage: false });
  assert.match(html, /workspace owner manages automatic sync/);
  assert.match(html, /Last run finished/);
  assert.doesNotMatch(html, /<button/);
});
