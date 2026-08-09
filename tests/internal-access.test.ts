import assert from "node:assert/strict";
import test from "node:test";
import { isAuthorizedFounderContext } from "../server/internal-access.ts";
import { requireInternalAccessMfa, resolveInternalEntitlements } from "../server/entitlements/engine.ts";
import { ApiError } from "../server/api.ts";
import type { AccessContext } from "../server/authorization.ts";

function context(overrides: Partial<AccessContext> = {}): AccessContext {
  const subject = "58f1ed83-647a-4297-bcea-e3db7d864bc8";
  return {
    identity: {
      email: "hussienissa@lexedgeconsulting.com",
      displayName: "Hussien Issa",
      subject,
      provider: "supabase",
      emailVerified: true,
      assuranceLevel: "aal2",
      sessionId: "verified-session",
    },
    userId: subject,
    organizationId: "workspace-founder",
    role: "owner",
    authSubject: subject,
    authProvider: "supabase",
    organization: {} as AccessContext["organization"],
    ...overrides,
  };
}

test("founder bootstrap eligibility requires the exact verified and subject-bound account", () => {
  assert.equal(isAuthorizedFounderContext(context()), true);
  assert.equal(isAuthorizedFounderContext(context({ identity: { ...context().identity, email: "other@lexedgeconsulting.com" } })), false);
  assert.equal(isAuthorizedFounderContext(context({ identity: { ...context().identity, emailVerified: false } })), false);
  assert.equal(isAuthorizedFounderContext(context({ identity: { ...context().identity, subject: "attacker" } })), false);
  assert.equal(isAuthorizedFounderContext(context({ authSubject: "different-subject" })), false);
  assert.equal(isAuthorizedFounderContext(context({ role: "admin" })), false);
});

test("internal founder access includes all normal Pro and BookLoq capabilities without billing state", () => {
  const effective = resolveInternalEntitlements({ accessLevel: "founder", mfaRequired: false });
  assert.equal(effective.accessType, "internal");
  assert.equal(effective.plan, null);
  assert.equal(effective.subscriptionStatus, null);
  assert.equal(effective.features.includes("forecasting.advanced"), true);
  assert.equal(effective.features.includes("permissions.advanced"), true);
  assert.equal(effective.features.includes("bookloq"), true);
  assert.equal(effective.features.includes("bookloq.reconciliation"), true);
  assert.deepEqual(effective.addons, ["bookloq"]);
});

test("internal full access requires a verified second authentication factor", () => {
  const grant = { accessLevel: "founder", mfaRequired: true } as const;
  assert.doesNotThrow(() => requireInternalAccessMfa(grant, "aal2"));
  for (const assurance of ["aal1", null] as const) {
    assert.throws(
      () => requireInternalAccessMfa(grant, assurance),
      (error: unknown) => error instanceof ApiError && error.code === "MFA_REQUIRED_FOR_INTERNAL_ACCESS",
    );
  }
});
