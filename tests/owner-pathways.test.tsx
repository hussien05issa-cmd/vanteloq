import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SETTINGS_SECTIONS, settingsSectionFromHash, settingsSectionHash } from "../domain/settings-navigation";
import { NAVIGATION_VIEW_IDS } from "../domain/navigation-preferences";
import { businessSwitchUrl, workspaceViewFromHash, workspaceViewHash } from "../domain/owner-navigation";
import { changeOnboardingCountry, validReportingTimezone } from "../domain/onboarding-reporting";
import { BusinessWorkspaceChoices, OwnerWorkspaceContext } from "../app/business-workspace-selector";
import LocationSetupDialog from "../app/location-setup-dialog";

test("every owner settings destination and workspace round-trips through reload and browser history", () => {
  for (const section of SETTINGS_SECTIONS) {
    const hash = settingsSectionHash(section.id);
    assert.equal(settingsSectionFromHash(hash), section.id);
    assert.equal(workspaceViewFromHash(hash), "Settings");
  }
  assert.equal(settingsSectionHash("billing"), "#billing");
  for (const view of [...NAVIGATION_VIEW_IDS, "Profit", "Cash", "Bookkeeping"] as const) assert.equal(workspaceViewFromHash(workspaceViewHash(view)), view);
  for (const hash of ["#settings/unknown", "#workspace/unknown", "#settings/locations?workspace=other", "#workspace/Reports", ""]) assert.equal(workspaceViewFromHash(hash), null);
});

test("switching businesses clears another business's callbacks and pending view without changing the host", () => {
  const url = new URL(businessSwitchUrl("https://vanteloq.example/?workspace=retail&integration=google&connection=connected&oauth_state_id=old#billing", "cafe_2"));
  assert.equal(url.origin, "https://vanteloq.example");
  assert.equal(url.pathname, "/");
  assert.deepEqual([...url.searchParams], [["workspace", "cafe_2"]]);
  assert.equal(url.hash, "");
  assert.throws(() => businessSwitchUrl(url.href, "../../other"), /valid business/);
  assert.throws(() => businessSwitchUrl(url.href, ""), /valid business/);
});

test("country changes preserve entered address and customized reporting settings", () => {
  const form = { country: "CA", province: "AB", address: "10 Example Street", city: "Edmonton", postalCode: "T5J 0N3", currency: "USD", timezone: "America/Toronto" };
  const next = changeOnboardingCountry(form, "GB");
  assert.deepEqual(next, { ...form, country: "GB", province: "" });
  assert.equal(form.country, "CA");
  const defaults = changeOnboardingCountry({ ...form, currency: "CAD", timezone: "America/Edmonton" }, "GB");
  assert.equal(defaults.currency, "GBP");
  assert.equal(defaults.timezone, "Europe/London");
  assert.equal(changeOnboardingCountry(form, "CA").province, "AB");
  for (const zone of ["America/Edmonton", "America/Denver", "Asia/Tokyo", "UTC"]) assert.equal(validReportingTimezone(zone), true);
  for (const zone of ["", "Alberta", "invalid/zone"]) assert.equal(validReportingTimezone(zone), false);
});

test("mixed-sector choices expose actual access and never infer a default when selection is required", () => {
  const listing = { currentWorkspaceId: null, workspaces: [{ id: "retail", name: "Example Retail", industry: "Retail", role: "owner", setupComplete: true }, { id: "cafe", name: "Example Café", industry: "Café", role: "admin", setupComplete: false }] };
  const html = renderToStaticMarkup(<BusinessWorkspaceChoices listing={listing} selectedWorkspaceId={null} onSwitch={() => {}}/>);
  assert.match(html, /value="" selected="">Choose a business/);
  assert.match(html, /Example Café · Café · Setup pending/);
  assert.match(html, /Save open changes before switching/);
  assert.doesNotMatch(html, /value="retail" selected/);
  const context = renderToStaticMarkup(<OwnerWorkspaceContext businessName="Example Café" industry="Café" locationName="Downtown"/>);
  assert.match(context, /Current business and reporting scope/);
  assert.match(context, /Downtown/);
  const restricted = renderToStaticMarkup(<OwnerWorkspaceContext businessName="Example Café" industry="Café" locationName={null} limitedScope/>);
  assert.match(restricted, /All accessible locations/);
});

test("location setup uses an explicitly named modal, required fields and optional field labels", () => {
  const html = renderToStaticMarkup(<LocationSetupDialog close={() => {}} create={async () => {}} country="GB" timezone="Europe/London" currency="GBP" locale="en-GB"/>);
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby=/);
  assert.match(html, /aria-label="Close location setup"/);
  const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map(match => match[0]);
  assert.match(inputs.find(input => input.includes('name="name"')) ?? "", /required=""/);
  assert.match(html, /<select name="countryCode" required/);
  assert.match(html, /value="GB" selected/);
  const currencyInput = inputs.find(input => input.includes('name="currency"')) ?? "";
  assert.match(currencyInput, /required=""/);
  assert.match(currencyInput, /value="GBP"/);
  assert.match(html, /Address Line 2.*?\(Optional\)/);
  assert.match(html, /type="submit" class="primary"/);
});
