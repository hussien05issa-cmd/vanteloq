import assert from "node:assert/strict";
import test from "node:test";
import { buildOwnerBriefing, type OwnerBriefingInput, type OwnerBriefingSignal } from "../domain/owner-briefing.ts";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const hours = (open = "09:00", close = "17:00", closedDays: string[] = []) => days.map(day => ({ day, open, close, closed: closedDays.includes(day) }));
const input = (now: string, changes: Partial<OwnerBriefingInput> = {}): OwnerBriefingInput => ({ now, timezone: "America/Edmonton", hours: hours(), signals: [], ...changes });
const signal = (id: string, changes: Partial<OwnerBriefingSignal> = {}): OwnerBriefingSignal => ({
  id, title: "Review an unpaid bill", detail: "A recorded approved bill is overdue.", nextStep: "Check the bill and recorded payments before taking action.", destination: "BookLoQ",
  severity: "high", category: "payables", status: "recorded", dueDate: "2026-10-01",
  evidence: [{ label: "Outstanding bill amount in cents", value: 12500, source: "BookLoQ bill balances", asOf: "2026-10-05" }], ...changes,
});

test("business-local opening, trading and closing phases use saved hours", () => {
  const cases = [
    ["2026-10-05T13:59:00Z", "daily"], // 07:59 Edmonton
    ["2026-10-05T14:00:00Z", "opening"],
    ["2026-10-05T15:59:00Z", "opening"],
    ["2026-10-05T16:00:00Z", "trading"],
    ["2026-10-05T22:00:00Z", "closing"],
    ["2026-10-05T23:00:00Z", "closing"],
    ["2026-10-06T05:59:00Z", "closing"], // Closing persists through local evening.
  ] as const;
  for (const [now, phase] of cases) {
    const result = buildOwnerBriefing(input(now));
    assert.equal(result.schedule.phase, phase, now);
    assert.equal(result.schedule.localDate, "2026-10-05");
    assert.equal(result.schedule.opensAt, "2026-10-05T09:00");
    assert.equal(result.schedule.closesAt, "2026-10-05T17:00");
  }
});

test("overnight sessions retain their opening business date across a month boundary", () => {
  const overnight = hours("22:00", "06:00");
  const result = buildOwnerBriefing(input("2026-11-01T05:30:00Z", { timezone: "UTC", hours: JSON.stringify(overnight) }));
  assert.equal(result.schedule.phase, "closing");
  assert.equal(result.schedule.localDate, "2026-11-01");
  assert.equal(result.schedule.businessDate, "2026-10-31");
  assert.equal(result.schedule.opensAt, "2026-10-31T22:00");
  assert.equal(result.schedule.closesAt, "2026-11-01T06:00");
  assert.equal(result.schedule.overnight, true);
  assert.equal(buildOwnerBriefing(input("2026-11-01T06:30:00Z", { timezone: "UTC", hours: overnight })).schedule.phase, "closing");
  assert.equal(buildOwnerBriefing(input("2026-11-01T12:00:00Z", { timezone: "UTC", hours: overnight })).schedule.phase, "daily");
});

test("a closed day preserves a prior overnight session, then returns to the closed-day review", () => {
  const schedule = hours("22:00", "06:00", ["Sunday"]);
  const during = buildOwnerBriefing(input("2026-11-01T05:00:00Z", { timezone: "UTC", hours: schedule }));
  assert.equal(during.schedule.phase, "closing");
  assert.equal(during.schedule.businessDate, "2026-10-31");
  const after = buildOwnerBriefing(input("2026-11-01T10:00:00Z", { timezone: "UTC", hours: schedule }));
  assert.equal(after.schedule.phase, "closed");
  assert.equal(after.schedule.nextOpeningAt, "2026-11-02T22:00");
  assert.equal(after.schedule.opensAt, null);
});

test("a fully closed week has no invented next opening", () => {
  const result = buildOwnerBriefing(input("2026-10-05T16:00:00Z", { hours: hours("", "", days) }));
  assert.equal(result.schedule.phase, "closed");
  assert.equal(result.schedule.nextOpeningAt, null);
});

test("DST repeated hours and host-independent local dates follow the business zone", () => {
  const schedule = hours("22:00", "06:00");
  const first = buildOwnerBriefing(input("2026-11-01T07:30:00Z", { hours: schedule }));
  const repeated = buildOwnerBriefing(input("2026-11-01T08:30:00Z", { hours: schedule }));
  for (const result of [first, repeated]) {
    assert.equal(result.schedule.localTime, "01:30");
    assert.equal(result.schedule.businessDate, "2026-10-31");
    assert.equal(result.schedule.phase, "trading");
  }
  const tokyo = buildOwnerBriefing(input("2026-10-05T23:30:00Z", { timezone: "Asia/Tokyo" }));
  assert.equal(tokyo.schedule.localDate, "2026-10-06");
  assert.equal(tokyo.schedule.localTime, "08:30");
  assert.equal(tokyo.schedule.phase, "opening");
});

test("missing, malformed and overlapping hours fall back without asserting a closure", () => {
  const duplicate = hours(); duplicate[6] = { ...duplicate[6], day: "Monday" };
  const overlap = hours("22:00", "06:00"); overlap[1] = { ...overlap[1], open: "05:00", close: "10:00" };
  for (const value of [undefined, "{", [], hours("09:00", "09:00"), hours("25:00", "17:00"), duplicate, overlap]) {
    const result = buildOwnerBriefing(input("2026-10-05T16:00:00Z", { hours: value }));
    assert.equal(result.schedule.phase, "daily");
    assert.equal(result.schedule.localDate, "2026-10-05");
    assert.equal(result.schedule.opensAt, null);
    assert.match(result.schedule.reason!, /business-hour/);
  }
});

test("invalid timezone or clock never silently schedules against the host or UTC", () => {
  for (const timezone of ["", "Invalid/Zone"]) {
    const result = buildOwnerBriefing(input("2026-10-05T16:00:00Z", { timezone }));
    assert.equal(result.schedule.phase, "daily");
    assert.equal(result.schedule.timeZone, null);
    assert.equal(result.schedule.businessDate, null);
    assert.equal(result.schedule.localTime, null);
    assert.match(result.schedule.reason!, /time zone/);
  }
  const invalid = buildOwnerBriefing(input("not-a-date"));
  assert.equal(invalid.generatedAt, null);
  assert.equal(invalid.schedule.phase, "daily");
  assert.equal(invalid.schedule.localDate, null);
  const ambiguous = buildOwnerBriefing(input("2026-10-05T16:00:00"));
  assert.equal(ambiguous.generatedAt, null);
  assert.equal(ambiguous.schedule.businessDate, null);
});

test("only source-backed recorded signals are included and known zero remains evidence", () => {
  const result = buildOwnerBriefing(input("2026-10-05T16:00:00Z", { signals: [
    signal("known-zero", { category: "cash", evidence: [{ label: "Recorded available cash in cents", value: 0, source: "Approved bank source", asOf: "2026-10-05T15:00:00Z" }] }),
    signal("unknown", { evidence: [{ label: "Cash", value: null, source: "Bank source" }] }),
    signal("unavailable", { status: "unavailable" }),
    signal("forecast", { status: "estimate" }),
    signal("sourceless", { evidence: [{ label: "Cash", value: 100, source: " " }] }),
    signal("not-finite", { evidence: [{ label: "Cash", value: NaN, source: "Bank source" }] }),
    signal("status", { category: "data", evidence: [{ label: "Source status", value: "stale", source: "Connection status" }] }),
  ] }));
  assert.deepEqual(result.priorities.map(item => item.id), ["known-zero", "status"]);
  assert.equal(result.priorities[0].evidence[0].value, 0);
  assert.equal(result.excludedCount, 5);
  assert.equal(result.totalCount, 2);
});

test("critical issues outrank high items, then financial categories and due dates determine stable order", () => {
  const signals = [signal("ops", { category: "operations", severity: "critical" }), signal("cash", { category: "cash" }),
    signal("bill-later", { severity: "critical", dueDate: "2026-10-04" }), signal("bill-first", { severity: "critical", dueDate: "2026-09-30" }),
    signal("receivable", { category: "receivables", severity: "critical" })];
  const expected = ["bill-first", "bill-later", "receivable", "ops", "cash"];
  assert.deepEqual(buildOwnerBriefing(input("2026-10-05T16:00:00Z", { signals })).priorities.map(item => item.id), expected);
  assert.deepEqual(buildOwnerBriefing(input("2026-10-05T16:00:00Z", { signals: [...signals].reverse() })).priorities.map(item => item.id), expected);
});

test("critical and total counts remain uncapped and duplicate issues use their strongest severity", () => {
  const signals = Array.from({ length: 7 }, (_, index) => signal(`bill-${index}`, { severity: "critical" }));
  signals.push(signal("bill-0", { severity: "low" }));
  const result = buildOwnerBriefing(input("2026-10-05T16:00:00Z", { signals }));
  assert.equal(result.priorities.length, 5);
  assert.equal(result.criticalCount, 7);
  assert.equal(result.totalCount, 7);
  assert.equal(result.omittedCount, 2);
  assert.equal(result.excludedCount, 1);
  assert.deepEqual(result.priorities.map(item => item.rank), [1, 2, 3, 4, 5]);
  assert.equal(result.priorities[0].severity, "critical");
});

test("invalid source dates are not invented, inputs stay unchanged and output is deterministic", () => {
  const value = input("2026-10-05T16:00:00Z", { signals: [signal("date", { dueDate: "2026-02-30", evidence: [
    { label: "Unpaid bill", value: 50, source: "BookLoQ", asOf: "2026-02-30" },
    { label: "Recorded source", value: "reviewed", source: "Owner review", asOf: "2026-10-05T09:30:00" },
  ] })] });
  const original = JSON.stringify(value);
  const first = buildOwnerBriefing(value), second = buildOwnerBriefing(value);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(value), original);
  assert.equal(first.priorities[0].dueDate, null);
  assert.deepEqual(first.priorities[0].evidence.map(item => item.asOf), [null, null]);
});

test("empty briefings do not claim financial health or scheduled delivery", () => {
  const result = buildOwnerBriefing(input("2026-10-05T16:00:00Z"));
  assert.equal(result.priorities.length, 0);
  assert.match(result.summary, /does not confirm/);
  assert.match(result.boundary, /open or refresh/);
  assert.match(result.boundary, /not background alerts or delivered notifications/);
  assert.match(result.boundary, /Missing data is not a zero/);
  assert.ok(result.checklist.length > 0);
});
