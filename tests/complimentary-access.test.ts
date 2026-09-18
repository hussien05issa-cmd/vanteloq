import assert from "node:assert/strict";
import test from "node:test";
import { configuredOffers, complimentarySetupInput } from "../server/complimentary-access.ts";
import { resolveComplimentaryEntitlements } from "../server/entitlements/engine.ts";
const offer = { id: "a385cc2c-566e-4d18-b939-94737813eb75", email: "invited@example.invalid", plan: "pro" as const, bookloq: true, expiresAt: null };
test("complimentary configuration fails closed on malformed, duplicated or expired grants", () => {
  assert.deepEqual(configuredOffers("not json"), []);
  assert.deepEqual(configuredOffers(JSON.stringify([offer, offer])), []);
  assert.deepEqual(configuredOffers(JSON.stringify([{ ...offer, plan: "founder" }])), []);
  assert.deepEqual(configuredOffers(JSON.stringify([{ ...offer, expiresAt: "invalid" }])), []);
  assert.deepEqual(configuredOffers(JSON.stringify([{ ...offer, expiresAt: "2020-01-01T00:00:00Z" }])), []);
  assert.equal(configuredOffers(JSON.stringify([offer]))[0].email, offer.email);
});
test("complimentary access retains catalogue limits and optional BookLoQ without claiming a paid subscription", () => {
  const full = resolveComplimentaryEntitlements(offer);
  assert.equal(full.accessType, "complimentary"); assert.equal(full.subscriptionStatus, null);
  assert.ok(full.features.includes("bookloq")); assert.equal(full.limits?.users, 25);
  const limited = resolveComplimentaryEntitlements({ ...offer, plan: "starter", bookloq: false });
  assert.equal(limited.features.includes("bookloq"), false); assert.equal(limited.limits?.users, 3);
});
test("the short setup cannot record consent or bypass MFA on the recipient's behalf", () => {
  const identity = { email: offer.email, displayName: "Invitee", subject: "subject", provider: "supabase" as const, emailVerified: true, assuranceLevel: "aal2" as const, sessionId: "session" };
  assert.throws(() => complimentarySetupInput({ complimentaryId: offer.id }, identity, offer), /Review and accept/);
  assert.throws(() => complimentarySetupInput({ complimentaryId: offer.id }, { ...identity, assuranceLevel: "aal1" }, offer), /multi-factor/);
});
