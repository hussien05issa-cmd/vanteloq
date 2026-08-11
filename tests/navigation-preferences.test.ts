import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHiddenNavigation, setNavigationVisibility } from "../domain/navigation-preferences.ts";

const allowed = ["Dashboard", "Inventory", "Customers", "Marketing", "Settings"];
const protectedViews = ["Dashboard", "Settings"];

test("unknown and protected views cannot be persisted as hidden", () => {
  assert.deepEqual(
    normalizeHiddenNavigation(["Inventory", "Dashboard", "Unknown", "Inventory"], allowed, protectedViews),
    ["Inventory"],
  );
});

test("a hidden view can be restored without disturbing other preferences", () => {
  const hidden = setNavigationVisibility(["Inventory", "Marketing"], "Inventory", true, allowed, protectedViews);
  assert.deepEqual(hidden, ["Marketing"]);
});
