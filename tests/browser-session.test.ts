import test from "node:test";
import assert from "node:assert/strict";
import type { Session } from "@supabase/supabase-js";
import { createSessionReader } from "../app/browser-session";

const clock = 1_800_000_000_000;
const session = (token = "fixture-token", seconds = 3600) => ({ access_token: token, expires_at: clock / 1000 + seconds } as Session);

test("a fresh auth-event snapshot serves concurrent API calls without reentering the SDK", async () => {
  let reads = 0;
  const reader = createSessionReader(async () => { reads++; return new Promise(() => {}); }, { now: () => clock });
  const current = session();
  reader.update(current);
  assert.deepEqual(await Promise.all([reader.read(), reader.read(), reader.read()]), [current, current, current]);
  assert.equal(reads, 0);
});

test("near-expiry sessions share a bounded refresh and never return an expired token", async () => {
  let reads = 0;
  const fresh = session("refreshed");
  const reader = createSessionReader(async () => { reads++; return fresh; }, { now: () => clock });
  reader.update(session("near-expiry", 10));
  assert.deepEqual(await Promise.all([reader.read(), reader.read()]), [fresh, fresh]);
  assert.equal(reads, 1);
  const expired = createSessionReader(async () => session("expired", -1), { now: () => clock });
  await assert.rejects(expired.read(), /sign-in needs to refresh/);
});

test("sign-out and account changes override an old pending lookup", async () => {
  for (const replacement of [null, session("other-account")]) {
    let resolve: (value: Session | null) => void = () => {};
    const reader = createSessionReader(() => new Promise(done => { resolve = done; }), { now: () => clock });
    const pending = reader.read();
    reader.update(replacement);
    resolve(session("old-account"));
    assert.equal(await pending, replacement);
    assert.equal(await reader.read(), replacement);
  }
});

test("a stalled lookup times out and a later attempt can recover", async () => {
  let reads = 0;
  const reader = createSessionReader(async () => { reads++; return reads === 1 ? new Promise(() => {}) : session(); }, { now: () => clock, timeoutMs: 20 });
  await assert.rejects(reader.read(), /sign-in session could not be checked/);
  assert.equal((await reader.read())?.access_token, "fixture-token");
});
