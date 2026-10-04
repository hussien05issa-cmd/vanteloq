import assert from "node:assert/strict";
import test from "node:test";
import { filterSettingsSections, SETTINGS_SECTIONS } from "../domain/settings-navigation";

test("settings search matches customer tasks, labels and all query terms", () => {
  assert.deepEqual(filterSettingsSections("   "), SETTINGS_SECTIONS);
  for (const query of ["cancel", "unsubscribe", "CANCEL SUBSCRIPTION", "plans", "renewal"]) assert.deepEqual(filterSettingsSections(query).map(section => section.id), ["billing"]);
  for (const query of ["delete", "deletion", "DELETE WORKSPACE"]) assert.deepEqual(filterSettingsSections(query).map(section => section.id), ["account"]);
  assert.deepEqual(filterSettingsSections("privacy").map(section => section.id), ["privacy"]);
  assert.deepEqual(filterSettingsSections("notifications").map(section => section.id), ["notifications"]);
  assert.deepEqual(filterSettingsSections("no matching settings"), []);
  assert.deepEqual(filterSettingsSections("cancel deletion"), []);
});
