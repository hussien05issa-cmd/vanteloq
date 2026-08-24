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
