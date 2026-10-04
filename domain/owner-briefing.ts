/** A deterministic presentation of supplied, authorized evidence. No delivery or AI work occurs here. */
export type OwnerBriefingPhase = "opening" | "trading" | "closing" | "closed" | "daily";
export type OwnerBriefingCategory = "cash" | "payables" | "receivables" | "sales" | "inventory" | "operations" | "data";
export type OwnerBriefingSeverity = "critical" | "high" | "medium" | "low";
export type OwnerBriefingEvidence = {
  label: string;
  value: number | string | null;
  source: string;
  asOf?: string | null;
};
export type OwnerBriefingSignal = {
  id: string;
  title: string;
  detail: string;
  nextStep: string;
  destination: string;
  severity: OwnerBriefingSeverity;
  category: OwnerBriefingCategory;
  evidence: readonly OwnerBriefingEvidence[];
  dueDate?: string | null;
  status?: "recorded" | "estimate" | "unavailable";
};
export type OwnerBriefingInput = {
  now: Date | string | number;
  timezone: string;
  /** Saved hoursJson or its parsed seven BusinessHour rows. */
  hours: unknown;
  signals: readonly OwnerBriefingSignal[];
};
export type OwnerBriefingSchedule = {
  phase: OwnerBriefingPhase;
  businessDate: string | null;
  localDate: string | null;
  localTime: string | null;
  timeZone: string | null;
  /** Local civil timestamps, without an inferred UTC offset. */
  opensAt: string | null;
  closesAt: string | null;
  nextOpeningAt: string | null;
  overnight: boolean;
  reason: string | null;
};
export type OwnerBriefingPriority = Omit<OwnerBriefingSignal, "status" | "evidence" | "dueDate"> & {
  rank: number;
  status: "recorded";
  evidence: Array<OwnerBriefingEvidence & { asOf: string | null }>;
  dueDate: string | null;
};
export type OwnerBriefing = {
  generatedAt: string | null;
  schedule: OwnerBriefingSchedule;
  title: string;
  summary: string;
  priorities: OwnerBriefingPriority[];
  /** Counts all eligible, deduplicated signals before the five-item presentation limit. */
  criticalCount: number;
  totalCount: number;
  omittedCount: number;
  /** Unavailable, estimated, malformed or duplicate inputs, not additional alerts. */
  excludedCount: number;
  checklist: string[];
  boundary: string;
};

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const severityOrder: Record<OwnerBriefingSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const categoryOrder: Record<OwnerBriefingCategory, number> = { cash: 0, payables: 1, receivables: 2, sales: 3, inventory: 4, operations: 5, data: 6 };
const dayMilliseconds = 86_400_000;
const briefingWindowMinutes = 60;
type Hours = { open: number; close: number; closed: boolean };
type Session = { start: number; end: number; date: string; overnight: boolean };
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const dateText = (day: number) => new Date(day * dayMilliseconds).toISOString().slice(0, 10);
const localTimestamp = (minute: number) => `${dateText(Math.floor(minute / 1440))}T${String(Math.floor(minute % 1440 / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

function clockMinute(value: unknown): number | null {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function parseHours(input: unknown): Hours[] | null {
  let rows = input;
  if (typeof rows === "string") {
    try { rows = JSON.parse(rows); } catch { return null; }
  }
  if (!Array.isArray(rows) || rows.length !== weekdays.length) return null;
  const hours = new Map<string, Hours>();
  for (const candidate of rows) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const row = candidate as Record<string, unknown>;
    if (typeof row.day !== "string" || !weekdays.includes(row.day as typeof weekdays[number]) || hours.has(row.day) || typeof row.closed !== "boolean") return null;
    const open = clockMinute(row.open), close = clockMinute(row.close);
    // Equal times are ambiguous, not evidence of either a closed or a 24-hour day.
    if (!row.closed && (open === null || close === null || open === close)) return null;
    hours.set(row.day, { open: open ?? 0, close: close ?? 0, closed: row.closed });
  }
  const ordered = weekdays.map(day => hours.get(day)!);
  for (let index = 0; index < ordered.length; index++) {
    const previous = ordered[(index + 6) % 7], current = ordered[index];
    if (!previous.closed && previous.close < previous.open && !current.closed && current.open < previous.close) return null;
  }
  return ordered;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const milliseconds = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 10) === value;
}

function evidenceTimestamp(value: unknown): string | null {
  if (validDate(value)) return value;
  // Require a declared offset rather than parsing a machine-local datetime.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !validDate(value.slice(0, 10))) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function briefingSchedule(now: Date, timezone: string, hoursInput: unknown): OwnerBriefingSchedule {
  const fallback: OwnerBriefingSchedule = { phase: "daily", businessDate: null, localDate: null, localTime: null, timeZone: null, opensAt: null, closesAt: null, nextOpeningAt: null, overnight: false, reason: null };
  if (!Number.isFinite(now.getTime())) return { ...fallback, reason: "A valid current time is needed to select the opening or closing briefing." };
  let parts: Intl.DateTimeFormatPart[];
  if (typeof timezone !== "string" || !timezone.trim()) return { ...fallback, reason: "Save a valid business time zone to schedule opening and closing briefings." };
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  } catch { return { ...fallback, reason: "Save a valid business time zone to schedule opening and closing briefings." }; }
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === name)!.value;
  const localDate = `${part("year")}-${part("month")}-${part("day")}`, localTime = `${part("hour")}:${part("minute")}`;
  const localDay = Date.parse(`${localDate}T00:00:00Z`) / dayMilliseconds;
  const localMinute = localDay * 1440 + Number(part("hour")) * 60 + Number(part("minute"));
  const base = { ...fallback, businessDate: localDate, localDate, localTime, timeZone: timezone };
  const hours = parseHours(hoursInput);
  if (!hours) return { ...base, reason: "Review the seven saved business-hour entries before using opening and closing timing. Missing, overlapping or ambiguous hours are not assumed." };
  const weekday = new Date(localDay * dayMilliseconds).getUTCDay();
  const sessions: Session[] = [];
  for (let offset = -1; offset <= 7; offset++) {
    const entry = hours[(weekday + offset + 7) % 7];
    if (entry.closed) continue;
    const start = (localDay + offset) * 1440 + entry.open;
    const overnight = entry.close < entry.open;
    sessions.push({ start, end: (localDay + offset + Number(overnight)) * 1440 + entry.close, date: dateText(localDay + offset), overnight });
  }
  const next = sessions.find(session => session.start > localMinute);
  const active = sessions.find(session => session.start <= localMinute && session.end > localMinute);
  const describe = (phase: OwnerBriefingPhase, session: Session): OwnerBriefingSchedule => ({
    ...base, phase, businessDate: session.date, opensAt: localTimestamp(session.start), closesAt: localTimestamp(session.end),
    nextOpeningAt: next ? localTimestamp(next.start) : null, overnight: session.overnight,
  });
  if (active) {
    const phase = active.end - localMinute <= briefingWindowMinutes ? "closing"
      : localMinute - active.start < briefingWindowMinutes ? "opening" : "trading";
    return describe(phase, active);
  }
  if (next && next.start - localMinute <= briefingWindowMinutes) return describe("opening", next);
  const completed = [...sessions].reverse().find(session => session.end <= localMinute);
  // A same-day closing briefing remains useful through the evening. An overnight
  // session stays associated with its opening date, including its first hour after closing.
  if (completed && (completed.date === localDate || completed.overnight && localMinute - completed.end < briefingWindowMinutes)) return describe("closing", completed);
  if (!hours[weekday].closed) {
    const today = sessions.find(session => session.date === localDate);
    if (today) return { ...describe("daily", today), reason: "Preparation for today's saved opening time. The opening briefing starts one hour before trading." };
  }
  return { ...base, phase: "closed", nextOpeningAt: next ? localTimestamp(next.start) : null, reason: "The saved regular hours mark today as closed. Holiday and exceptional hours are not inferred." };
}

function normalizeSignal(signal: OwnerBriefingSignal): Omit<OwnerBriefingPriority, "rank"> | null {
  if (!signal || typeof signal !== "object" || (signal.status !== undefined && signal.status !== "recorded")) return null;
  if (!Object.hasOwn(severityOrder, signal.severity) || !Object.hasOwn(categoryOrder, signal.category)) return null;
  const text = [signal.id, signal.title, signal.detail, signal.nextStep, signal.destination];
  if (text.some(value => typeof value !== "string" || !value.trim())) return null;
  if (!Array.isArray(signal.evidence)) return null;
  const evidence = signal.evidence.flatMap(item => {
    if (!item || typeof item.label !== "string" || !item.label.trim() || typeof item.source !== "string" || !item.source.trim()) return [];
    const value = typeof item.value === "string" ? item.value.trim() : item.value;
    if (typeof value === "number" ? !Number.isFinite(value) : typeof value !== "string" || !value) return [];
    return [{ label: item.label.trim(), value, source: item.source.trim(), asOf: evidenceTimestamp(item.asOf) }];
  });
  if (!evidence.length) return null;
  return { ...signal, id: signal.id.trim(), title: signal.title.trim(), detail: signal.detail.trim(), nextStep: signal.nextStep.trim(), destination: signal.destination.trim(), evidence, dueDate: validDate(signal.dueDate) ? signal.dueDate : null, status: "recorded" };
}

const checklist: Record<OwnerBriefingPhase, string[]> = {
  opening: ["Review urgent financial items and confirm any payments against current records.", "Confirm today's staffing, stock and operating changes before trading."],
  trading: ["Address the highest-priority recorded issue first.", "Check source freshness before acting on a changing financial figure."],
  closing: ["Review the day's recorded sales and payment differences; confirm all expected sources have arrived.", "Record unresolved items and assign the next action before the next opening."],
  closed: ["Review critical recorded items that cannot wait until the next opening.", "Confirm the next trading day's hours and planned responsibilities."],
  daily: ["Review the highest-priority recorded items and assign their next actions.", "Confirm business hours and source coverage before relying on a timed briefing."],
};

export function buildOwnerBriefing(input: OwnerBriefingInput): OwnerBriefing {
  // Bare datetime strings depend on the server's own timezone, so reject them.
  const now = input.now instanceof Date ? new Date(input.now.getTime())
    : typeof input.now === "string" ? new Date(evidenceTimestamp(input.now) ?? NaN) : new Date(input.now);
  const schedule = briefingSchedule(now, input.timezone, input.hours);
  const rawSignals = Array.isArray(input.signals) ? input.signals : [];
  const normalized = rawSignals.map(normalizeSignal).filter((signal): signal is NonNullable<typeof signal> => signal !== null);
  normalized.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]
    || categoryOrder[a.category] - categoryOrder[b.category]
    || compareText(a.dueDate ?? "9999-12-31", b.dueDate ?? "9999-12-31")
    || compareText(a.id, b.id) || compareText(a.title, b.title));
  const unique = normalized.filter((signal, index, all) => all.findIndex(other => other.id === signal.id) === index);
  const priorities = unique.slice(0, 5).map((signal, index) => ({ ...signal, rank: index + 1 }));
  const criticalCount = unique.filter(signal => signal.severity === "critical").length;
  const titles: Record<OwnerBriefingPhase, string> = { opening: "Opening briefing", trading: "Today's priorities", closing: "Closing briefing", closed: "Closed-day review", daily: "Daily owner briefing" };
  const summary = criticalCount ? `${criticalCount} critical recorded ${criticalCount === 1 ? "item needs" : "items need"} review first.`
    : unique.length ? `${unique.length} recorded ${unique.length === 1 ? "item needs" : "items need"} attention. Review the evidence and next step below.`
      : "No source-backed attention items are available. This does not confirm that every area is clear.";
  return { generatedAt: Number.isFinite(now.getTime()) ? now.toISOString() : null, schedule, title: titles[schedule.phase], summary, priorities, criticalCount,
    totalCount: unique.length, omittedCount: unique.length - priorities.length, excludedCount: rawSignals.length - unique.length, checklist: [...checklist[schedule.phase]],
    boundary: "Briefings reflect available recorded data and refresh when you open or refresh the workspace. They are not background alerts or delivered notifications. Timing follows saved regular business hours; holiday changes are not inferred. Suggested next steps require your review. Missing data is not a zero, a forecast or confirmation that nothing needs attention.",
  };
}
