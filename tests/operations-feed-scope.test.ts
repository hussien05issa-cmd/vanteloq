import assert from "node:assert/strict";
import test from "node:test";
import { operationsFeedWindow } from "../server/operations.ts";

const base = { organizationId: "organization-a", accessibleLocationIds: ["north", "south"], selectedLocationId: null, locationIds: null, locationRefs: null };

test("an unchanged authorized scope resumes its cursor independent of location ordering", async () => {
  const initial = await operationsFeedWindow(base, null, 50);
  assert.equal(initial.after, 0);
  assert.match(initial.scopeFingerprint, /^[a-f0-9]{64}$/);
  const same = await operationsFeedWindow({ ...base, accessibleLocationIds: ["south", "north", "north"] }, initial.scopeFingerprint, 50);
  assert.equal(same.after, 50);
  assert.equal(same.scopeFingerprint, initial.scopeFingerprint);
});

test("organization, grants, selection and provider reference changes cannot reuse another scope's cursor", async () => {
  const initial = await operationsFeedWindow(base, null, 0);
  const narrowed = { ...base, accessibleLocationIds: ["north"], locationIds: ["north"], locationRefs: ["north"] };
  for (const next of [
    { ...base, organizationId: "organization-b" }, narrowed,
    { ...base, selectedLocationId: "north", locationIds: ["north"], locationRefs: ["north"] },
    { ...base, accessibleLocationIds: [], locationIds: [], locationRefs: [] },
  ]) {
    const reset = await operationsFeedWindow(next, initial.scopeFingerprint, 999);
    assert.equal(reset.after, 0);
    assert.notEqual(reset.scopeFingerprint, initial.scopeFingerprint);
  }
  const north = await operationsFeedWindow(narrowed, null, 0);
  const remapped = await operationsFeedWindow({ ...narrowed, locationRefs: ["north", "square:permitted-ref"] }, north.scopeFingerprint, 999);
  assert.equal(remapped.after, 0);
});

test("a fingerprint is not a grant and missing, mismatched or invalid cursors restart safely", async () => {
  const current = await operationsFeedWindow(base, null, 0);
  for (const requested of [null, "another-scope"]) assert.equal((await operationsFeedWindow(base, requested, 99)).after, 0);
  for (const after of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal((await operationsFeedWindow(base, current.scopeFingerprint, after)).after, 0);
  assert.doesNotMatch(current.scopeFingerprint, /organization-a|north|south/);
});
