export const ADVISOR_PROVIDER_LABELS = { openai: "OpenAI" } as const;
export type AdvisorMode = keyof typeof ADVISOR_PROVIDER_LABELS;
export type AdvisorProvider = Exclude<AdvisorMode, "both">;
export function isAdvisorMode(value: unknown): value is AdvisorMode {
  return value === "openai";
}
export function advisorProviders(mode: AdvisorMode): AdvisorProvider[] {
  return [mode];
}
