import assert from "node:assert/strict";
import test from "node:test";
import { inspectRecoveryMfa, verifyRecoveryMfa } from "../shared/recovery-mfa.ts";

test("password recovery requires the enrolled authenticator before allowing a password change", async () => {
  const result = await inspectRecoveryMfa({
    getAuthenticatorAssuranceLevel: async () => ({
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    }),
    listFactors: async () => ({
      data: {
        totp: [{ id: "factor-owner", status: "verified" }],
      },
      error: null,
    }),
  });

  assert.deepEqual(result, {
    status: "challenge_required",
    factorId: "factor-owner",
  });
});

test("a current six digit authenticator code elevates password recovery to AAL2", async () => {
  const result = await verifyRecoveryMfa({
    challengeAndVerify: async () => ({ data: {}, error: null }),
    getAuthenticatorAssuranceLevel: async () => ({
      data: { currentLevel: "aal2", nextLevel: "aal2" },
      error: null,
    }),
  }, "factor-owner", "123456");

  assert.deepEqual(result, { status: "ready" });
});

test("the emailed recovery code opens a password recovery session", async () => {
  const verification = await import("../shared/signup-verification.ts");
  assert.equal(typeof verification.verifyRecoveryCode, "function");

  const calls: unknown[] = [];
  const expectedSession = { access_token: "access", refresh_token: "refresh" };
  const session = await verification.verifyRecoveryCode({
    auth: {
      verifyOtp: async (input: unknown) => {
        calls.push(input);
        return { data: { session: expectedSession }, error: null };
      },
    },
  }, " Owner@Example.com ", "12 34-56 78");

  assert.equal(session, expectedSession);
  assert.deepEqual(calls, [{
    email: "owner@example.com",
    token: "12345678",
    type: "recovery",
  }]);
});

test("an incomplete recovery email code is rejected before contacting Supabase", async () => {
  const verification = await import("../shared/signup-verification.ts");
  assert.equal(typeof verification.verifyRecoveryCode, "function");

  let called = false;
  await assert.rejects(
    verification.verifyRecoveryCode({
      auth: {
        verifyOtp: async () => {
          called = true;
          return { data: { session: null }, error: null };
        },
      },
    }, "owner@example.com", "12345"),
    /recovery code from your email/i,
  );
  assert.equal(called, false);
});
