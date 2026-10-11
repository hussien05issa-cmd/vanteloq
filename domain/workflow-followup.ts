/** Civil-time scheduling and collection rules. No network or inferred accounting entries. */
export const FOLLOWUP_AUTHORIZATION = "owner-followup-v1";
export type FollowupNote = {
  lastContactDate: string | null; contactNote: string; promisedDate: string | null;
  promisedCents: number | null; disputeOwner: string; nextAction: string; nextActionDate: string | null;
  paused: boolean; remindersEnabled: boolean; reminderIntervalDays: number;
};
export type FollowupPreferences = {
  opening: boolean; closing: boolean; emailBriefings: boolean; invoiceReminders: boolean;
  quietStart: string; quietEnd: string; openingLeadMinutes: number; closingDelayMinutes: number;
  exceptions: { date: string; closed: boolean; open: string; close: string }[];
};
export const defaultFollowupNote: FollowupNote = { lastContactDate: null, contactNote: "", promisedDate: null, promisedCents: null, disputeOwner: "", nextAction: "", nextActionDate: null, paused: false, remindersEnabled: false, reminderIntervalDays: 7 };
export const defaultFollowupPreferences: FollowupPreferences = { opening: false, closing: false, emailBriefings: false, invoiceReminders: false, quietStart: "21:00", quietEnd: "07:00", openingLeadMinutes: 30, closingDelayMinutes: 15, exceptions: [] };
const dayMs = 86_400_000;
const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export function followupDate(value: unknown): string | null {
  if (value === "" || value == null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + "T00:00:00Z")) || new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value) throw Error("Choose a valid calendar date.");
  return value;
}
const text = (value: unknown, max: number) => { if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)) throw Error("Review the entered text."); return value.trim(); };
const bool = (value: unknown) => { if (typeof value !== "boolean") throw Error("Choose an explicit on or off setting."); return value; };
const integer = (value: unknown, min: number, max: number) => { if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw Error("Choose a number within the supported range."); return Number(value); };
const clock = (value: unknown) => { if (typeof value !== "string" || !clockPattern.test(value)) throw Error("Choose a valid time."); return value; };
const minute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
export function validateFollowupNote(input: unknown): FollowupNote {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Enter collection follow-up details.");
  const p = input as Record<string, unknown>;
  const promisedDate = followupDate(p.promisedDate), promisedCents = p.promisedCents == null ? null : integer(p.promisedCents, 1, 999_999_999_999);
  if (Boolean(promisedDate) !== Boolean(promisedCents)) throw Error("Enter both the promised payment date and amount, or leave both blank.");
  return { lastContactDate: followupDate(p.lastContactDate), contactNote: text(p.contactNote, 1000), promisedDate, promisedCents, disputeOwner: text(p.disputeOwner, 120), nextAction: text(p.nextAction, 500), nextActionDate: followupDate(p.nextActionDate), paused: bool(p.paused), remindersEnabled: bool(p.remindersEnabled), reminderIntervalDays: integer(p.reminderIntervalDays, 1, 30) };
}
export function validateFollowupPreferences(input: unknown): FollowupPreferences {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Review delivery preferences.");
  const p = input as Record<string, unknown>;
  if (!Array.isArray(p.exceptions) || p.exceptions.length > 40) throw Error("Save up to 40 exceptional business dates.");
  const dates = new Set<string>();
  const exceptions = p.exceptions.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Review each exceptional date.");
    const r = value as Record<string, unknown>, date = followupDate(r.date);
    if (!date || dates.has(date)) throw Error("Use each exceptional date once."); dates.add(date);
    const open = clock(r.open), close = clock(r.close), closed = bool(r.closed);
    if (!closed && open === close) throw Error("Opening and closing times must differ.");
    return { date, closed, open, close };
  });
  const quietStart = clock(p.quietStart), quietEnd = clock(p.quietEnd);
  if (quietStart === quietEnd) throw Error("Quiet hours must have different start and end times.");
  return { opening: bool(p.opening), closing: bool(p.closing), emailBriefings: bool(p.emailBriefings), invoiceReminders: bool(p.invoiceReminders), quietStart, quietEnd, openingLeadMinutes: integer(p.openingLeadMinutes, 0, 120), closingDelayMinutes: integer(p.closingDelayMinutes, 0, 120), exceptions };
}
export function followupClock(now: Date, timezone: string) {
  if (!Number.isFinite(now.getTime())) throw Error("A valid current time is required.");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (key: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === key)!.value;
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  return { date, minute: Number(get("hour")) * 60 + Number(get("minute")), serialDay: Date.parse(date + "T00:00:00Z") / dayMs };
}
export function isFollowupQuiet(localMinute: number, prefs: Pick<FollowupPreferences, "quietStart" | "quietEnd">) {
  const start = minute(prefs.quietStart), end = minute(prefs.quietEnd);
  return start < end ? localMinute >= start && localMinute < end : localMinute >= start || localMinute < end;
}
function deferQuiet(target: number, prefs: FollowupPreferences) {
  const local = ((target % 1440) + 1440) % 1440;
  if (!isFollowupQuiet(local, prefs)) return target;
  const end = minute(prefs.quietEnd);
  return target - local + end + (local >= end ? 1440 : 0);
}
export type BriefingSlot = { kind: "opening" | "closing"; businessDate: string; key: string };
export function dueBriefingSlots(now: Date, timezone: string, hoursInput: unknown, prefs: FollowupPreferences): BriefingSlot[] {
  const local = followupClock(now, timezone), current = local.serialDay * 1440 + local.minute;
  const hourAgo = followupClock(new Date(now.getTime() - 60 * 60_000), timezone);
  const lostMinutes = Math.max(0, current - (hourAgo.serialDay * 1440 + hourAgo.minute) - 60);
  const eligibilityMinutes = 60 + lostMinutes;
  let hours: unknown = hoursInput;
  if (typeof hours === "string") { try { hours = JSON.parse(hours); } catch { return []; } }
  if (!Array.isArray(hours) || hours.length !== 7) return [];
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  if (new Set(hours.map(r => r?.day)).size !== 7 || hours.some(r => !days.includes(r?.day) || typeof r.closed !== "boolean" || !clockPattern.test(r.open) || !clockPattern.test(r.close) || !r.closed && r.open === r.close)) return [];
  const slots: BriefingSlot[] = [];
  for (let offset = -2; offset <= 1; offset++) {
    const serial = local.serialDay + offset, date = new Date(serial * dayMs).toISOString().slice(0, 10);
    const hoursRow = prefs.exceptions.find(r => r.date === date) ?? hours.find(r => r.day === days[new Date(serial * dayMs).getUTCDay()]);
    if (!hoursRow || hoursRow.closed) continue;
    const opens = minute(hoursRow.open), closes = minute(hoursRow.close);
    for (const kind of ["opening", "closing"] as const) {
      if (!prefs[kind]) continue;
      const target = deferQuiet(serial * 1440 + (kind === "opening" ? opens - prefs.openingLeadMinutes : closes + (closes < opens ? 1440 : 0) + prefs.closingDelayMinutes), prefs);
      // One-hour eligibility window tolerates a delayed tick. Stable civil-date keys
      // deduplicate the repeated fall-back hour; spring-forward fires when time resumes.
      if (current >= target && current - target < eligibilityMinutes) slots.push({ kind, businessDate: date, key: `${kind}:${date}` });
    }
  }
  return slots;
}
export type ReminderInvoice = { status: string; dueDate: string; totalCents: number; paidCents: number; currency: string; recipient: string; demo: boolean };
export function reminderEligibility(invoice: ReminderInvoice, note: FollowupNote, today: string, lastAcceptedDate: string | null, approved: { recipient: string; totalCents: number; currency: string }) {
  if (!note.remindersEnabled || note.paused) return "paused";
  if (invoice.demo) return "demonstration";
  if (!["sent", "viewed", "due", "overdue", "partially_paid"].includes(invoice.status) || note.disputeOwner) return "closed_or_disputed";
  if (!Number.isSafeInteger(invoice.totalCents) || !Number.isSafeInteger(invoice.paidCents) || invoice.totalCents <= invoice.paidCents || invoice.paidCents < 0) return "settled_or_invalid";
  if (invoice.recipient !== approved.recipient || invoice.totalCents !== approved.totalCents || invoice.currency !== approved.currency || !/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(invoice.recipient)) return "approval_changed";
  if (!followupDate(invoice.dueDate) || invoice.dueDate >= today) return "not_overdue";
  if (note.promisedDate && note.promisedDate >= today) return "promise_pending";
  const prior = [note.lastContactDate, lastAcceptedDate].filter((v): v is string => Boolean(v)).sort().at(-1);
  if (prior && (Date.parse(today + "T00:00:00Z") - Date.parse(prior + "T00:00:00Z")) / dayMs < note.reminderIntervalDays) return "contact_interval";
  return "eligible";
}
export function followupRetryDelay(attempt: number) { return Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, Math.min(attempt - 1, 6))); }
