import assert from "node:assert/strict";
import test from "node:test";
import { createPersonalAdminEligibilityController } from "../domain/personal-admin-eligibility";

function fixture() {
  let scope = "own-account:own-workspace";
  let state = { allowed: false, checking: true };
  const pending: Array<{ signal: AbortSignal; resolve: (allowed: boolean) => void }> = [];
  const controller = createPersonalAdminEligibilityController({ scope, readScope: () => scope,
    checkAccess: signal => new Promise<boolean>(resolve => pending.push({ signal, resolve })),
    onChange: next => { state = next; },
  });
  return { controller, pending, read: () => state, switchScope: () => { scope = "other-account:other-workspace"; } };
}
const settled = () => new Promise<void>(resolve => setImmediate(resolve));

test("same-user TOKEN_REFRESHED invalidates access immediately and waits for fresh MFA eligibility", async () => {
  const f = fixture();
  void f.controller.check(true); f.pending[0].resolve(true); await settled();
  assert.equal(f.read().allowed, true);
  // The hook forwards every Auth event, including a refresh for the same subject.
  f.controller.authChanged(true);
  assert.deepEqual(f.read(), { allowed: false, checking: true });
  f.pending[1].resolve(false); await settled();
  assert.deepEqual(f.read(), { allowed: false, checking: false });
  f.controller.dispose();
});

test("sign-out and workspace changes clear access and stale requests cannot restore it", async () => {
  const f = fixture();
  void f.controller.check(true);
  f.controller.authChanged(false);
  assert.equal(f.pending[0].signal.aborted, true);
  f.pending[0].resolve(true); await settled();
  assert.deepEqual(f.read(), { allowed: false, checking: false });
  void f.controller.check(true);
  f.switchScope();
  await f.controller.check();
  f.pending[1].resolve(true); await settled();
  assert.equal(f.read().allowed, false);
  assert.equal(f.pending.length, 2, "foreign scope must not issue an eligibility request");
  f.controller.dispose();
});

test("new auth snapshots fence earlier allowed responses, and disposal ignores late work", async () => {
  const f = fixture();
  void f.controller.check(true);
  f.controller.authChanged(true);
  f.pending[1].resolve(false); await settled();
  f.pending[0].resolve(true); await settled();
  assert.equal(f.read().allowed, false);
  void f.controller.check(true);
  f.controller.dispose();
  const before = f.read();
  f.pending[2].resolve(true); await settled();
  assert.deepEqual(f.read(), before);
});
