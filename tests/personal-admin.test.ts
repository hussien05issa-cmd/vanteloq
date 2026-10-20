import assert from "node:assert/strict";
import test from "node:test";
import { isPersonalAdminContext } from "../server/personal-admin";
import { initialPersonalLab, personalLabReducer } from "../domain/personal-admin-lab";
import { INDUSTRY_TEMPLATES } from "../domain/industry-templates";
import type { AccessContext } from "../server/authorization";

function owner(): AccessContext {
  const subject = "58f1ed83-647a-4297-bcea-e3db7d864bc8";
  return { userId: "own-local-profile", organizationId: "own-workspace", role: "owner", authSubject: subject, authProvider: "supabase", organization: {} as AccessContext["organization"], identity: { subject, email: "hussienissa@lexedgeconsulting.com", provider: "supabase", displayName: "Owner", emailVerified: true, emailConfirmed: true, assuranceLevel: "aal2", sessionId: "own-session" } };
}

test("personal admin requires the verified pinned owner, bound identity and current MFA", () => {
  assert.equal(isPersonalAdminContext(owner()), true);
  const other = "25cfe9cc-c031-41a5-a71c-0749ccbc9f12";
  for (const context of [
    { ...owner(), role: "admin" }, { ...owner(), role: "employee" },
    { ...owner(), authSubject: other }, { ...owner(), authProvider: "sites" },
    { ...owner(), identity: { ...owner().identity, subject: other } },
    { ...owner(), authSubject: other, identity: { ...owner().identity, subject: other } },
    { ...owner(), identity: { ...owner().identity, email: "other-owner@example.invalid" } },
    { ...owner(), identity: { ...owner().identity, emailConfirmed: false } },
    { ...owner(), identity: { ...owner().identity, emailConfirmed: undefined } },
    { ...owner(), identity: { ...owner().identity, emailVerified: false } },
    { ...owner(), identity: { ...owner().identity, assuranceLevel: "aal1" } },
    { ...owner(), identity: { ...owner().identity, sessionId: null } },
  ] as AccessContext[]) assert.equal(isPersonalAdminContext(context), false);
});

test("all supported business types can be rehearsed without changing saved configuration", () => {
  assert.equal(INDUSTRY_TEMPLATES.length, 12);
  for (const template of INDUSTRY_TEMPLATES) {
    const original = initialPersonalLab();
    const selected = personalLabReducer(original, { type: "business", industry: template.id });
    assert.equal(selected.configuration.templateId, template.id);
    assert.equal(selected.step, 1);
    assert.equal(original.configuration.templateId, "retail");
    const advanced = personalLabReducer(personalLabReducer(selected, { type: "next" }), { type: "next" });
    assert.equal(advanced.step, 3);
    assert.equal(personalLabReducer(advanced, { type: "next" }).step, 3);
    assert.equal(personalLabReducer(advanced, { type: "back" }).step, 2);
  }
});

test("restart clears only the personal rehearsal, including priorities and nested component state", () => {
  const first = personalLabReducer(initialPersonalLab(), { type: "business", industry: "dealership" });
  const changed = personalLabReducer({ ...first, step: 3 }, { type: "overview", overview: { ...first.overview, priorities: ["cash"] } });
  const restarted = personalLabReducer(changed, { type: "restart" });
  assert.deepEqual({ ...restarted, generation: 0 }, initialPersonalLab());
  assert.equal(restarted.generation, changed.generation + 1);
  assert.equal(changed.configuration.templateId, "dealership");
  assert.deepEqual(changed.overview.priorities, ["cash"]);
});
