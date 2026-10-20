import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonalBusinessLabView } from "../app/personal-admin-lab";
import { initialPersonalLab, personalLabReducer } from "../domain/personal-admin-lab";
import { INDUSTRY_TEMPLATES } from "../domain/industry-templates";
import { filterSettingsSections, settingsSectionFromHash } from "../domain/settings-navigation";

test("Personal admin is absent from ordinary settings and discoverable only after server eligibility", () => {
  assert.equal(filterSettingsSections("personal admin").length, 0);
  assert.deepEqual(filterSettingsSections("personal admin", true).map(section => section.id), ["personal-admin"]);
  assert.equal(settingsSectionFromHash("#settings/personal-admin"), "personal-admin");
});

test("business lab gives all supported choices, accessible progress and a personal reset", () => {
  const html = renderToStaticMarkup(<PersonalBusinessLabView state={initialPersonalLab()} dispatch={() => {}}/>);
  assert.match(html, /Personal admin/);
  assert.match(html, /Business lab/);
  for (const template of INDUSTRY_TEMPLATES) assert.ok(html.includes(`value="${template.id}"`));
  assert.match(html, /Restart onboarding preview/);
  assert.match(html, /aria-current="step"/);
  assert.match(html, /Only this preview resets/);
  assert.doesNotMatch(html, /Create workspace|Subscribe|type="submit"|\/api\/v1\/onboarding/);
});

test("rehearsal shows local dashboard choices and explicitly fictional workflow records", () => {
  for (const template of INDUSTRY_TEMPLATES) {
    let state = personalLabReducer(initialPersonalLab(), { type: "business", industry: template.id });
    state = personalLabReducer(state, { type: "next" });
    const dashboard = renderToStaticMarkup(<PersonalBusinessLabView state={state} dispatch={() => {}}/>);
    assert.match(dashboard, /Build your overview/);
    state = personalLabReducer(state, { type: "next" });
    const sample = renderToStaticMarkup(<PersonalBusinessLabView state={state} dispatch={() => {}}/>);
    assert.match(sample, /Fictional sample data/);
    assert.match(sample, /Preview complete/);
    assert.doesNotMatch(sample, /Confirm business settings|Create task|Post journal|Connect Stripe/);
  }
});
