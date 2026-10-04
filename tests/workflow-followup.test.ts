import assert from "node:assert/strict";
import test from "node:test";
import { defaultFollowupNote, defaultFollowupPreferences, dueBriefingSlots, followupClock, isFollowupQuiet, reminderEligibility, validateFollowupNote, validateFollowupPreferences } from "../domain/workflow-followup.ts";
const hours = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(day => ({ day, open: "09:00", close: "17:00", closed: false }));
const prefs = { ...defaultFollowupPreferences, opening: true, closing: true };
test("all delivery starts off and explicit booleans, dates, promises are required", () => {
  assert.equal(defaultFollowupPreferences.invoiceReminders, false); assert.equal(defaultFollowupPreferences.opening, false);
  assert.throws(() => validateFollowupPreferences({ ...prefs, opening: "true" }));
  assert.throws(() => validateFollowupPreferences({ ...prefs, quietStart: "07:00" }));
  assert.throws(() => validateFollowupNote({ ...defaultFollowupNote, promisedDate: "2026-02-30", promisedCents: 100 }));
  assert.throws(() => validateFollowupNote({ ...defaultFollowupNote, promisedDate: "2026-10-04" }));
  assert.throws(() => validateFollowupNote({ ...defaultFollowupNote, promisedDate: "2026-10-04", promisedCents: 1.1 }));
});
test("same instant selects different business schedules by timezone", () => {
  const now = new Date("2026-10-04T14:35:00Z");
  assert.equal(dueBriefingSlots(now, "America/Edmonton", hours, prefs)[0]?.kind, "opening");
  assert.equal(dueBriefingSlots(now, "Asia/Tokyo", hours, prefs).length, 0);
  assert.equal(followupClock(now, "America/Edmonton").minute, 515);
});
test("closed-day exceptions and invalid hours do not invent briefings", () => {
  const now = new Date("2026-10-04T14:35:00Z");
  assert.deepEqual(dueBriefingSlots(now, "America/Edmonton", hours, { ...prefs, exceptions: [{ date: "2026-10-04", closed: true, open: "09:00", close: "17:00" }] }), []);
  assert.deepEqual(dueBriefingSlots(now, "UTC", [], prefs), []);
  assert.deepEqual(dueBriefingSlots(now, "UTC", hours.map(r => ({ ...r, day: "Monday" })), prefs), []);
});
test("overnight closing is associated with the prior business day and quiet hours defer it", () => {
  const overnight = hours.map(r => ({ ...r, open: "18:00", close: "02:00" }));
  const result = dueBriefingSlots(new Date("2026-10-05T13:05:00Z"), "America/Edmonton", overnight, prefs);
  assert.deepEqual(result, [{ kind: "closing", businessDate: "2026-10-04", key: "closing:2026-10-04" }]);
  assert.equal(isFollowupQuiet(23 * 60, prefs), true); assert.equal(isFollowupQuiet(7 * 60, prefs), false);
});
test("DST repeated hour has one civil-date key and spring-forward tolerates lost minutes", () => {
  const custom = hours.map(r => ({ ...r, open: "01:30", close: "12:00" }));
  const p = { ...prefs, closing: false, openingLeadMinutes: 0, quietStart: "20:00", quietEnd: "00:00" };
  const a = dueBriefingSlots(new Date("2026-11-01T07:35:00Z"), "America/Edmonton", custom, p), b = dueBriefingSlots(new Date("2026-11-01T08:35:00Z"), "America/Edmonton", custom, p);
  assert.equal(a[0].key, b[0].key);
  const spring = hours.map(r => ({ ...r, open: "02:30", close: "12:00" }));
  assert.equal(dueBriefingSlots(new Date("2026-03-08T09:01:00Z"), "America/Edmonton", spring, p)[0].kind, "opening");
  const lostHourStart = hours.map(r => ({ ...r, open: "02:00", close: "12:00" }));
  assert.equal(dueBriefingSlots(new Date("2026-03-08T09:05:00Z"), "America/Edmonton", lostHourStart, p)[0].kind, "opening");
  assert.equal(dueBriefingSlots(new Date("2026-03-08T10:05:00Z"), "America/Edmonton", lostHourStart, p).length, 0);
});
test("reminders require reviewed recipient and amount, respect payments/disputes/promises/contact cadence", () => {
  const invoice = { status: "sent", dueDate: "2026-09-20", totalCents: 10000, paidCents: 2000, currency: "CAD", recipient: "fictional@example.invalid", demo: false }, note = { ...defaultFollowupNote, remindersEnabled: true }, approved = { recipient: invoice.recipient, totalCents: 10000, currency: "CAD" };
  const eligible = (i = invoice, n = note, last: string | null = null) => reminderEligibility(i, n, "2026-10-04", last, approved);
  assert.equal(eligible(), "eligible"); assert.equal(eligible({ ...invoice, paidCents: 10000 }), "settled_or_invalid");
  assert.equal(eligible({ ...invoice, status: "disputed" }), "closed_or_disputed");
  assert.equal(eligible(invoice, { ...note, disputeOwner: "Review team" }), "closed_or_disputed");
  assert.equal(eligible({ ...invoice, recipient: "different@example.invalid" }), "approval_changed");
  assert.equal(eligible({ ...invoice, totalCents: 11000 }), "approval_changed");
  assert.equal(eligible(invoice, { ...note, promisedDate: "2026-10-05", promisedCents: 8000 }), "promise_pending");
  assert.equal(eligible(invoice, note, "2026-10-01"), "contact_interval");
  assert.equal(eligible(invoice, { ...note, paused: true }), "paused");
  assert.equal(eligible({ ...invoice, demo: true }), "demonstration");
});
