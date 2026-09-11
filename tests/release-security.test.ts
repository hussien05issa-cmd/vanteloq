import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, readRequestBytes, readJsonObject } from "../server/api";
import { oauthBrowserCookie, requireOAuthBrowser } from "../server/integrations/oauth-browser";
import { hasUnrestrictedLocationRole } from "../domain/location-scope";
import { isCalendarDate } from "../domain/calendar-date";
import { csvCell } from "../domain/csv";
import { isRecentMfa, latestMfaTime } from "../shared/recent-mfa";

test("body limits stop chunked requests without trusting content-length", async () => {
  let canceled = false;
  let reads = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { reads += 1; controller.enqueue(new Uint8Array(8)); },
    cancel() { canceled = true; },
  });
  const request = new Request("https://example.invalid", { method: "POST", body, duplex: "half" } as RequestInit);
  await assert.rejects(readRequestBytes(request, 12), (error: unknown) => error instanceof ApiError && error.status === 413);
  assert.equal(canceled, true);
  assert.ok(reads <= 3, "reader must not drain an oversized stream");
});

test("bounded readers preserve exact bytes and valid JSON at the boundary", async () => {
  const bytes = new TextEncoder().encode('{"memo":"café"}');
  const request = () => new Request("https://example.invalid", { method: "POST", headers: { "content-type": "application/json" }, body: bytes });
  assert.deepEqual(await readRequestBytes(request(), bytes.length), bytes);
  assert.deepEqual(await readJsonObject(request(), bytes.length), { memo: "café" });
  await assert.rejects(readRequestBytes(request(), bytes.length - 1), (error: unknown) => error instanceof ApiError && error.status === 413);
});

test("OAuth callback requires the initiating provider-specific browser cookie", () => {
  const state = "a".repeat(43);
  const issued = oauthBrowserCookie("stripe", state);
  assert.match(issued, /Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600/);
  const cookie = issued.split(";")[0];
  const request = (value: string) => new Request("https://example.invalid/callback", { headers: { cookie: value } });
  assert.doesNotThrow(() => requireOAuthBrowser(request(cookie), "stripe", state));
  for (const value of ["", cookie.replace(state, "b".repeat(43)), `${cookie}; ${cookie}`, cookie.replace("stripe", "square")]) {
    assert.throws(() => requireOAuthBrowser(request(value), "stripe", state), (error: unknown) => error instanceof ApiError && error.code === "OAUTH_BROWSER_BINDING_INVALID");
  }
});

test("custom administrator compatibility roles do not widen location scope", () => {
  assert.equal(hasUnrestrictedLocationRole("admin", { systemKey: null }), false);
  assert.equal(hasUnrestrictedLocationRole("admin", { systemKey: "location_manager" }), false);
  assert.equal(hasUnrestrictedLocationRole("admin", { systemKey: "organization_administrator" }), true);
  assert.equal(hasUnrestrictedLocationRole("admin", null), true);
  assert.equal(hasUnrestrictedLocationRole("admin", { roleId: null, systemKey: null }), true);
  assert.equal(hasUnrestrictedLocationRole("owner", null), true);
  assert.equal(hasUnrestrictedLocationRole("employee", null), false);
});

test("journal dates reject rollover dates and accept leap days", () => {
  for (const value of ["2026-02-30", "2026-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "not a date"]) assert.equal(isCalendarDate(value), false);
  for (const value of ["2028-02-29", "2026-09-05"]) assert.equal(isCalendarDate(value), true);
});

test("CSV protects text formulas without changing numeric accounting values", () => {
  for (const value of ["=1+1", "+SUM(A1)", "-1+1", "@SUM(A1)", "  =1+1", "\t=1+1"]) assert.equal(csvCell(value), `'${value}`);
  assert.equal(csvCell(-123), "-123");
  assert.equal(csvCell("North, Edmonton"), '"North, Edmonton"');
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell(null), "");
});

test("permanent actions require a recent MFA event, not a refreshed token", () => {
  const now = 1_800_000_000;
  assert.equal(latestMfaTime([{ method: "password", timestamp: now }]), null);
  assert.equal(latestMfaTime([{ method: "totp", timestamp: now - 20 }]), now - 20);
  assert.equal(latestMfaTime([{ method: "mfa/totp", timestamp: now - 10 }]), now - 10);
  assert.equal(isRecentMfa(now - 301, now), false);
  assert.equal(isRecentMfa(now + 100, now), false);
  assert.equal(isRecentMfa(null, now), false);
  assert.equal(isRecentMfa(now - 300, now), true);
});
