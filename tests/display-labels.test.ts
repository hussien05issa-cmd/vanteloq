import assert from "node:assert/strict";
import test from "node:test";
import { humanizeIdentifier, providerDisplayName, workspaceViewLabel } from "../domain/display-labels.ts";

test("provider names and connector states use professional presentation labels", () => {
  assert.equal(providerDisplayName("lightspeed-r"), "Lightspeed Retail R-Series");
  assert.equal(providerDisplayName("clover"), "Clover");
  assert.equal(providerDisplayName("square"), "Square");
  assert.equal(humanizeIdentifier("approval_paused"), "Approval paused");
  assert.equal(humanizeIdentifier("oauth_callback_required"), "OAuth callback required");
});

test("the advisor is consistently identified as Gemini Advisor", () => {
  assert.equal(workspaceViewLabel("Advisor"), "Gemini Advisor");
  assert.equal(workspaceViewLabel("Reports"), "Reports");
});
