export const ADVISOR_PROVIDER_LABELS = { gemini: "Google Gemini", openai: "OpenAI", both: "Google Gemini and OpenAI" } as const;
export type AdvisorMode = keyof typeof ADVISOR_PROVIDER_LABELS;
export type AdvisorProvider = Exclude<AdvisorMode, "both">;
export function isAdvisorMode(value: unknown): value is AdvisorMode {
  return value === "gemini" || value === "openai" || value === "both";
}
export function advisorProviders(mode: AdvisorMode): AdvisorProvider[] {
  return mode === "both" ? ["gemini", "openai"] : [mode];
}

/** Select one available provider on first load. Comparing both is an explicit choice. */
export function defaultAdvisorProvider(providers: Record<AdvisorProvider, { ready: boolean }>): AdvisorProvider {
  return providers.openai.ready ? "openai" : providers.gemini.ready ? "gemini" : "openai";
}
