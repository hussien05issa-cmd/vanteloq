import assert from "node:assert/strict";
import test from "node:test";
import { advisorUnavailableReason } from "../domain/advisor-availability.ts";

test("advisor reports the known source-consistency block without claiming no sales", () => {
  const reason = advisorUnavailableReason("retail", { error: { code: "RETAIL_SOURCE_OVERLAP", message: "PRIVATE ACCOUNT VALUE" } });
  assert.match(reason, /overlap or a source is still syncing/);
  assert.match(reason, /does not mean.*no sales records/);
  assert.doesNotMatch(reason, /PRIVATE ACCOUNT VALUE/);
});

test("advisor distinguishes add-on access from empty books and scopes reasons to the domain", () => {
  assert.match(advisorUnavailableReason("bookloq", { error: { code: "ADDON_NOT_INCLUDED" } }), /does not currently have access/);
  assert.doesNotMatch(advisorUnavailableReason("retail", { error: { code: "ADDON_NOT_INCLUDED" } }), /BookLoQ add-on/);
});

test("unknown or malformed failures never forward internal error text to AI", () => {
  for (const body of [null, {}, "PRIVATE", { error: null }, { error: { code: "UNKNOWN", message: "PRIVATE" } }, { error: { code: "__proto__" } }]) {
    assert.match(advisorUnavailableReason("bookloq", body), /not supplied for this request/);
    assert.doesNotMatch(advisorUnavailableReason("bookloq", body), /PRIVATE|__proto__/);
  }
});
