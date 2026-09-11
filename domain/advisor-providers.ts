export const ADVISOR_PROVIDER_LABELS = { gemini: "Google Gemini", openai: "OpenAI", both: "Google Gemini and OpenAI" } as const;
export type AdvisorMode = keyof typeof ADVISOR_PROVIDER_LABELS;
export type AdvisorProvider = Exclude<AdvisorMode, "both">;
export function isAdvisorMode(value: unknown): value is AdvisorMode {
  return value === "gemini" || value === "openai" || value === "both";
}
export function advisorProviders(mode: AdvisorMode): AdvisorProvider[] {
  return mode === "both" ? ["gemini", "openai"] : [mode];
}
