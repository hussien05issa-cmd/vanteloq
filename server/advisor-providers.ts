import { ADVISOR_APP_HELP_INSTRUCTIONS, ADVISOR_SYSTEM_INSTRUCTIONS } from "./advisor-instructions.ts";
import type { VanteloqRuntimeEnv } from "../db/index.ts";
import { ADVISOR_PROVIDER_LABELS, advisorProviders, type AdvisorMode, type AdvisorProvider } from "../domain/advisor-providers.ts";
import { ApiError } from "./api.ts";

export function advisorProviderStatus(env: VanteloqRuntimeEnv) {
  return {
    gemini: { ready: Boolean(env.GOOGLE_GEMINI_API_KEY?.trim()) && env.GOOGLE_GEMINI_PAID_SERVICE_CONFIRMED === "true", reason: !env.GOOGLE_GEMINI_API_KEY?.trim() ? "Google Gemini setup is pending." : env.GOOGLE_GEMINI_PAID_SERVICE_CONFIRMED !== "true" ? "Google Gemini business-data protection needs administrator verification." : null },
    openai: { ready: Boolean(env.OPENAI_API_KEY?.trim()), reason: env.OPENAI_API_KEY?.trim() ? null : "OpenAI setup is pending." },
  };
}

async function callProvider(provider: AdvisorProvider, text: string, env: VanteloqRuntimeEnv, request: typeof fetch, purpose: "analysis" | "help") {
  const instructions = purpose === "help" ? ADVISOR_APP_HELP_INSTRUCTIONS : ADVISOR_SYSTEM_INSTRUCTIONS;
  const model = provider === "gemini" ? env.VERTEX_AI_MODEL?.trim() || "gemini-2.5-flash" : env.OPENAI_MODEL?.trim() || "gpt-5-mini";
  const url = provider === "gemini" ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` : "https://api.openai.com/v1/responses";
  try {
    const response = await request(url, {
      // This Worker runtime supports manual/follow only. A 3xx response fails
      // the response.ok check below, so credentials never follow a redirect.
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(45_000),
      headers: provider === "gemini" ? { "content-type": "application/json", "x-goog-api-key": env.GOOGLE_GEMINI_API_KEY!.trim() } : { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY!.trim()}` },
      body: JSON.stringify(provider === "gemini"
        ? { systemInstruction: { parts: [{ text: instructions }] }, contents: [{ role: "user", parts: [{ text }] }], generationConfig: { temperature: 0.15, maxOutputTokens: 1400 } }
        : { model, instructions, input: text, store: false, max_output_tokens: 2400, reasoning: { effort: "low" } }),
    });
    if (!response.ok) {
      // Provider diagnostics can contain sensitive details. Expose only our own
      // actionable messages for known error codes, never their response text.
      const failure = await response.json().catch(() => null) as { error?: { code?: string; type?: string } } | null;
      const code = failure?.error?.code;
      if (provider === "openai" && code === "credit_balance_exhausted") {
        throw new ApiError(503, "ADVISOR_CREDITS_REQUIRED", "Vanteloq AI has no OpenAI API credits available. A Vanteloq administrator must add credits before analysis can resume.");
      }
      if (provider === "openai" && (failure?.error?.type === "insufficient_quota" || ["insufficient_quota", "organization_usage_limit_exceeded", "organization_spend_limit_exceeded", "project_spend_limit_exceeded"].includes(code ?? ""))) {
        throw new ApiError(503, "ADVISOR_BILLING_REQUIRED", "OpenAI API billing or a usage limit needs attention. A Vanteloq administrator must resolve it before analysis can resume.");
      }
      if (response.status === 429) throw new ApiError(429, "ADVISOR_RATE_LIMITED", `${ADVISOR_PROVIDER_LABELS[provider]} is temporarily rate limited. Wait a moment before trying again.`);
      if (response.status === 401 || response.status === 403) throw new ApiError(503, "ADVISOR_SETUP_REQUIRED", `${ADVISOR_PROVIDER_LABELS[provider]} access needs administrator attention. No analysis was completed.`);
      throw new Error("provider rejected request");
    }
    const body = await response.json() as {
      status?: string;
      candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    };
    const answer = provider === "gemini"
      ? body.candidates?.[0]?.finishReason === "STOP" ? body.candidates[0].content?.parts?.filter(part => !part.thought).map(part => part.text ?? "").join("").trim() : ""
      : body.status === "completed" ? body.output?.filter(item => item.type === "message").flatMap(item => item.content ?? []).filter(item => item.type === "output_text").map(item => item.text ?? "").join("\n").trim() : "";
    if (!answer) throw new Error("provider returned no complete answer");
    return { provider, model, text: answer };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "ADVISOR_PROVIDER_UNAVAILABLE", `${ADVISOR_PROVIDER_LABELS[provider]} could not complete the analysis. Try again shortly.`);
  }
}

export async function callAdvisor(mode: AdvisorMode, text: string, env: VanteloqRuntimeEnv, request: typeof fetch = fetch, purpose: "analysis" | "help" = "analysis") {
  const providers = advisorProviders(mode);
  const status = advisorProviderStatus(env);
  const blocked = providers.filter(provider => !status[provider].ready);
  // Check every selected provider before sending any customer information.
  if (blocked.length) return { configured: false as const, message: blocked.map(provider => status[provider].reason).join(" "), model: "", text: "", providers: [] };
  const results = await Promise.allSettled(providers.map(provider => callProvider(provider, text, env, request, purpose)));
  const completed = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  if (!completed.length) {
    const failure = results.find(result => result.status === "rejected" && result.reason instanceof ApiError);
    if (failure?.status === "rejected") throw failure.reason;
    throw new ApiError(502, "ADVISOR_UNAVAILABLE", "Vanteloq AI could not complete the analysis. Try again shortly.");
  }
  const partial = completed.length !== providers.length;
  const answer = mode === "both" ? results.map((result, index) => `${ADVISOR_PROVIDER_LABELS[providers[index]]}\n${result.status === "fulfilled" ? result.value.text : "Analysis unavailable for this request."}`).join("\n\n") : completed[0].text;
  return { configured: true as const, model: completed.map(result => result.model).join(" + "), text: answer, providers: completed.map(result => result.provider), partial };
}
