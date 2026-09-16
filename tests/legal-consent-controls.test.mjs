import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("account creation requires current legal versions and stores acceptance evidence", () => {
  const validation = read("../server/validation.ts");
  const onboarding = read("../app/api/v1/onboarding/route.ts");
  const schema = read("../db/schema.ts");

  assert.match(validation, /LEGAL_ACCEPTANCE_REQUIRED/);
  assert.match(validation, /TERMS_OF_SERVICE_VERSION/);
  assert.match(validation, /PRIVACY_POLICY_VERSION/);
  assert.match(onboarding, /INSERT OR IGNORE INTO legal_acceptances/);
  assert.match(onboarding, /legal-source:/);
  assert.match(onboarding, /legal-user-agent:/);
  assert.match(schema, /legal_acceptances_user_versions_unique/);
});

test("material legal updates require a new affirmative acceptance before billing", () => {
  const gate = read("../app/legal-acceptance-gate.tsx");
  const route = read("../app/api/v1/legal/acceptance/route.ts");
  const page = read("../app/page.tsx");
  assert.match(gate, /type="checkbox"/);
  assert.match(gate, /accepted: true/);
  assert.match(route, /material_policy_update/);
  assert.match(route, /requireSameOrigin\(request\)/);
  assert.match(route, /TERMS_OF_SERVICE_VERSION/);
  assert.match(page, /<LegalAcceptanceGate><BillingOnboardingGate>/);
});

test("Vanteloq AI requires explicit versioned consent and supports scoped deletion", () => {
  const route = read("../app/api/v1/advisor/chat/route.ts");
  const consentRoute = read("../app/api/v1/advisor/consent/route.ts");
  const privacy = read("../server/privacy.ts");
  const client = read("../app/vanteloq-app.tsx");
  const composer = read("../app/advisor-composer.tsx");
  const chatPrivacy = read("../app/advisor-privacy.tsx");

  assert.match(route, /ADVISOR_CONSENT_REQUIRED/);
  assert.match(consentRoute, /recordAdvisorConsent/);
  assert.match(route, /requireAdvisorConsent/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /organization_id = \? AND user_id = \?/);
  assert.match(route, /privacy\.advisor_conversation_deleted/);
  assert.match(privacy, /const provider = input.provider/);
  assert.match(client, /dataUseAccepted/);
  assert.match(client, /<AdvisorComposer/);
  assert.match(composer, /credentials, account numbers, customer names, search queries, page addresses, Business Profile content, invoice files and raw transactions/);
  assert.match(chatPrivacy, /Confirm deletion/);
  assert.match(chatPrivacy, /method: "DELETE"/);
  assert.match(client, /onNewChat=\{\(\) => \{ setAnalysisPeriod\(null\); resetVisibleChat\(\); \}\}/);
  assert.match(composer, /!dataUseAccepted && !consentLoading && !consentError/);
  assert.match(composer, /type="checkbox" checked=\{false\}/);
});
