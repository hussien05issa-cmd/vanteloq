import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { billingGateState } from "../shared/signup-funnel.ts";
import { verifySignupCode } from "../shared/signup-verification.ts";

test("signup verification accepts the emailed code and returns the authenticated session", async () => {
  const calls: unknown[] = [];
  const expectedSession = { access_token: "access", refresh_token: "refresh" };
  const client = {
    auth: {
      verifyOtp: async (input: unknown) => {
        calls.push(input);
        return { data: { session: expectedSession }, error: null };
      },
    },
  };

  const session = await verifySignupCode(
    client,
    " Owner@Example.com ",
    "12 34-56",
  );

  assert.equal(session, expectedSession);
  assert.deepEqual(calls, [{
    email: "owner@example.com",
    token: "123456",
    type: "email",
  }]);
});

test("signup verification rejects an incomplete code before contacting Supabase", async () => {
  let called = false;
  const client = {
    auth: {
      verifyOtp: async () => {
        called = true;
        return { data: { session: null }, error: null };
      },
    },
  };

  await assert.rejects(
    verifySignupCode(client, "owner@example.com", "12345"),
    /six-digit verification code/i,
  );
  assert.equal(called, false);
});

test("a completed workspace without paid access remains in subscription onboarding", async () => {
  assert.equal(billingGateState({ configured: true, accessType: "none" }), "checkout_required");
  assert.equal(billingGateState({ configured: true, accessType: "subscription" }), "ready");
  assert.equal(billingGateState({ configured: true, accessType: "internal" }), "ready");
  assert.equal(billingGateState({ configured: false, accessType: "none" }), "configuration_required");
});

test("the deployed confirmation email pipeline requires a six-digit code", () => {
  const output = execFileSync(process.execPath, [
    "scripts/deploy-auth-email-templates.mjs",
    "--dry-run",
  ], { encoding: "utf8" });
  const summary = JSON.parse(output) as { confirmationDelivery?: unknown };

  assert.equal(summary.confirmationDelivery, "six_digit_code");
});
