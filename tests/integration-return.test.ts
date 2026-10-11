import test from "node:test";
import assert from "node:assert/strict";
import { integrationReturnPath } from "../domain/integration-return";

test("provider and billing cleanup retain the selected business while removing transient grants", () => {
  assert.equal(integrationReturnPath("https://vanteloq.com/?workspace=business-a&integration=square&code=private&state=temporary&connection=connected#connections"), "/?workspace=business-a");
  assert.equal(integrationReturnPath("https://vanteloq.com/?workspace=business-b&billing=returned&session_id=checkout"), "/?workspace=business-b");
});

test("cleanup does not add a business selection or retain unsupported query parameters", () => {
  assert.equal(integrationReturnPath("https://vanteloq.com/?integration=slack&connection=connected"), "/");
  assert.throws(() => integrationReturnPath("https://vanteloq.com/demo?workspace=%3Cscript%3E&code=private"), /valid business workspace/);
});
