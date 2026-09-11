import assert from "node:assert/strict";
import test from "node:test";
import { recoveryEmailErrorMessage, signupErrorMessage } from "../shared/auth-error-messages.ts";

test("recovery distinguishes rate limits and CAPTCHA failures without revealing account or provider details", () => {
  assert.match(recoveryEmailErrorMessage({ status: 429 }), /wait a few minutes/i);
  assert.match(recoveryEmailErrorMessage({ code: "over_email_send_rate_limit" }), /one new recovery email/i);
  assert.match(recoveryEmailErrorMessage({ code: "captcha_failed" }), /fresh security check/i);
  assert.equal(recoveryEmailErrorMessage({ message: "smtp_password=secret" }), recoveryEmailErrorMessage({}));
  assert.doesNotMatch(recoveryEmailErrorMessage({ code: "user_not_found" }), /not found/i);
});

test("signup reports a backend password-policy mismatch without exposing provider details", () => {
  const providerMessage = "Password should be at least 1212 characters.";
  const message = signupErrorMessage({ status: 422, message: providerMessage });

  assert.match(message, /security settings are temporarily out of sync/i);
  assert.doesNotMatch(message, /1212|provider|Supabase/i);
});

test("signup gives recoverable guidance for rate limits and expired security checks", () => {
  assert.match(signupErrorMessage({ status: 429 }), /wait a moment/i);
  assert.match(
    signupErrorMessage({ status: 400, message: "captcha verification process failed" }),
    /fresh security check/i,
  );
});

test("signup keeps unknown provider errors private", () => {
  const message = signupErrorMessage({
    status: 500,
    message: "smtp_password=private internal provider failure",
  });

  assert.equal(message, "Account creation could not be completed. Check your details and try again.");
  assert.doesNotMatch(message, /smtp|private|provider/i);
});
