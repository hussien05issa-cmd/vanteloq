import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { hasCurrentLegalAcceptance, requireCurrentCheckoutAcceptance } from "../server/legal-acceptance.ts";
import { startStripeCheckout } from "../server/billing/checkout.ts";
import { PRIVACY_POLICY_VERSION, TERMS_OF_SERVICE_VERSION } from "../shared/legal-versions.ts";

test("a new purchase requires this user's current terms and privacy acceptance before any Stripe request", async () => {
  const sql = new DatabaseSync(":memory:");
  try {
    sql.exec("CREATE TABLE legal_acceptances(id TEXT PRIMARY KEY,user_id TEXT,terms_version TEXT,privacy_policy_version TEXT)");
    const database = { prepare(query: string) { return { bind(...values: SQLInputValue[]) { return { async first() { return sql.prepare(query).get(...values) ?? null; } }; } }; } } as unknown as D1Database;
    const add = (id: string, user: string, terms: string, privacy: string) => sql.prepare("INSERT INTO legal_acceptances VALUES (?,?,?,?)").run(id, user, terms, privacy);
    let stripeCalls = 0;
    const selection = { organizationId: "org", userId: "owner", email: "owner@example.invalid", plan: "starter" as const, interval: "month" as const, includeBookloq: false, customerId: null, origin: "https://vanteloq.example", database,
      fetcher: (async () => { stripeCalls++; throw new Error("Unexpected Stripe request"); }) as typeof fetch };
    assert.equal(await hasCurrentLegalAcceptance("owner", database), false);
    await assert.rejects(startStripeCheckout(selection), { code: "LEGAL_ACCEPTANCE_REQUIRED" });
    add("other", "different-user", TERMS_OF_SERVICE_VERSION, PRIVACY_POLICY_VERSION);
    add("old-terms", "owner", "2026-01-01", PRIVACY_POLICY_VERSION);
    add("old-privacy", "owner", TERMS_OF_SERVICE_VERSION, "2026-01-01");
    await assert.rejects(startStripeCheckout(selection), { code: "LEGAL_ACCEPTANCE_REQUIRED" });
    assert.equal(stripeCalls, 0);
    add("current", "owner", TERMS_OF_SERVICE_VERSION, PRIVACY_POLICY_VERSION);
    assert.equal(await hasCurrentLegalAcceptance("owner", database), true);
    await assert.doesNotReject(requireCurrentCheckoutAcceptance("owner", database));
  } finally { sql.close(); }
});
