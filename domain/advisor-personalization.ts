export type AdvisorPreferences = {
  length: "brief" | "balanced" | "detailed";
  explanation: "plain" | "technical";
  format: "adaptive" | "paragraphs" | "steps";
  priorities: Array<"sales" | "profitability" | "cash" | "inventory" | "operations">;
  textSize: "standard" | "large";
  spacing: "comfortable" | "compact";
};
export const advisorDefaults: AdvisorPreferences = { length: "balanced", explanation: "plain", format: "adaptive", priorities: [], textSize: "standard", spacing: "comfortable" };
export function advisorPreferences(value: unknown): AdvisorPreferences {
  const p = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    length: p.length === "brief" || p.length === "detailed" ? p.length : "balanced",
    explanation: p.explanation === "technical" ? "technical" : "plain",
    format: p.format === "paragraphs" || p.format === "steps" ? p.format : "adaptive",
    priorities: Array.isArray(p.priorities) ? [...new Set(p.priorities)].filter((v): v is AdvisorPreferences["priorities"][number] => ["sales", "profitability", "cash", "inventory", "operations"].includes(String(v))).slice(0, 5) : [],
    textSize: p.textSize === "large" ? "large" : "standard",
    spacing: p.spacing === "compact" ? "compact" : "comfortable",
  };
}
/** Narrow whole-message matches only. A greeting followed by a business question still uses evidence. */
export function isAdvisorGreeting(question: string) {
  return /^(hi|hello|hey|good (morning|afternoon|evening)|thanks|thank you)[!.\s]*$/i.test(question.trim());
}
export function advisorGreeting(question: string, displayName: string) {
  if (/^(thanks|thank you)/i.test(question)) return "You're welcome. What would you like to work on next?";
  const first = displayName.trim().split(/\s+/)[0];
  const safe = first && /^[\p{L}][\p{L}'’-]{0,29}$/u.test(first) ? ` ${first}` : "";
  return `Hi${safe}. What would you like to work on today?`;
}
export type AdvisorCoverage = {
  latestDate: string | null; sourceCount: number; days: number;
  from?: string | null; to?: string | null;
  lastUpdated?: string | null; sources?: string[];
};
export type AdvisorCurrentTurn = { question: string; answer: string; proof: string };
