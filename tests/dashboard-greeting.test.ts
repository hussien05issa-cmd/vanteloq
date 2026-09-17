import assert from "node:assert/strict";
import test from "node:test";
import { greetingForHour, greetingName, syncLabel } from "../app/dashboard-greeting";

test("greeting changes at the user's local noon and evening without inventing a name", () => {
  assert.equal(greetingForHour(null), "Welcome back");
  assert.equal(greetingForHour(0), "Good morning");
  assert.equal(greetingForHour(11), "Good morning");
  assert.equal(greetingForHour(12), "Good afternoon");
  assert.equal(greetingForHour(16), "Good afternoon");
  assert.equal(greetingForHour(17), "Good evening");
  assert.equal(greetingName("  Hussien Issa  "), "Hussien");
  for (const name of ["", "Account owner", "Team member", "person@example.com"]) assert.equal(greetingName(name), "");
});

test("sync status ages and never calls an invalid or future timestamp current", () => {
  const now = Date.parse("2026-09-17T12:00:00Z");
  assert.equal(syncLabel(null, now), "No sync yet");
  assert.equal(syncLabel("invalid", now), "Check sync time");
  assert.equal(syncLabel("2026-09-18T12:00:00Z", now), "Check sync time");
  assert.equal(syncLabel("2026-09-17T12:00:00Z", now), "Last sync just now");
  assert.equal(syncLabel("2026-09-17T11:59:00Z", now), "Last sync 1 minute ago");
  assert.equal(syncLabel("2026-09-17T11:45:00Z", now), "Last sync 15 minutes ago");
  assert.equal(syncLabel("2026-09-17T11:45:00Z", null), "Last sync recorded");
});
