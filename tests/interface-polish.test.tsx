import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import AuthPanel from "../app/auth-panel";
import CustomPlanForm from "../app/custom-plan-form";
import { PasswordInput } from "../app/form-primitives";
import WorkspaceSkeleton from "../app/workspace-skeleton";
import ProductDemo from "../app/product-demo";

test("signup preserves unchecked legal acceptance and distinguishes required fields", () => {
  const html = renderToStaticMarkup(<AuthPanel initialMode="signup" close={() => {}} authenticated={() => {}}/>);
  assert.match(html,/Required fields/);
  assert.match(html,/Full Name/);
  assert.match(html,/Email Address/);
  assert.match(html,/class="required-mark" aria-hidden="true"/);
  const checkbox = html.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0];
  assert.ok(checkbox);
  assert.match(checkbox,/required/);
  assert.doesNotMatch(checkbox,/checked/);
});
test("password visibility is an explicit non-submit control and starts concealed", () => {
  const html = renderToStaticMarkup(<PasswordInput required autoComplete="new-password" aria-label="Confirm Password"/>);
  assert.match(html,/type="password"/);
  assert.match(html,/aria-label="Confirm Password"/);
  assert.match(html,/type="button" aria-label="Show password"/);
  assert.match(html,/aria-pressed="false"/);
  assert.match(html,/aria-controls="[^"]+"/);
});
test("contact company is optional while a custom plan needs a business name", () => {
  const contact = renderToStaticMarkup(<CustomPlanForm purpose="contact"/>);
  const custom = renderToStaticMarkup(<CustomPlanForm purpose="custom_plan"/>);
  assert.doesNotMatch(contact.match(/<input[^>]*name="company"[^>]*>/)?.[0] ?? "",/required/);
  assert.match(custom.match(/<input[^>]*name="company"[^>]*>/)?.[0] ?? "",/required/);
  assert.match(contact,/\(Optional\)/);
});
test("skeletons announce system status without invented financial values", () => {
  const html = renderToStaticMarkup(<WorkspaceSkeleton label="Loading BookLoQ"/>);
  assert.match(html,/role="status"/);
  assert.match(html,/aria-busy="true"/);
  assert.match(html,/aria-hidden="true"/);
  assert.doesNotMatch(html,/\$0|Revenue|Profit/);
});
test("demo KPIs expose keyboard controls and retain real sample calculations", () => {
  const html = renderToStaticMarkup(<ProductDemo/>);
  assert.equal((html.match(/aria-expanded="false"/g) || []).length >= 4,true);
  assert.equal((html.match(/View Calculation/g) || []).length,4);
  assert.match(html,/Fictional business/);
  assert.doesNotMatch(html,/NaN|Infinity/);
});
