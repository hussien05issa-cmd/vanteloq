import { ADVISOR_APP_HELP_INSTRUCTIONS, ADVISOR_SYSTEM_INSTRUCTIONS } from "./advisor-instructions.ts";
import type { VanteloqRuntimeEnv } from "../db/index.ts";
import { ADVISOR_PROVIDER_LABELS, isAdvisorMode, type AdvisorMode, type AdvisorProvider } from "../domain/advisor-providers.ts";
import { ApiError } from "./api.ts";

export function advisorProviderStatus(env: VanteloqRuntimeEnv) {
  return {
    openai: { ready: Boolean(env.OPENAI_API_KEY?.trim()), reason: env.OPENAI_API_KEY?.trim() ? null : "OpenAI setup is pending." },
  };
}

async function callProvider(provider: AdvisorProvider, text: string, env: VanteloqRuntimeEnv, request: typeof fetch, purpose: "analysis" | "help") {
  const instructions = purpose === "help" ? ADVISOR_APP_HELP_INSTRUCTIONS : ADVISOR_SYSTEM_INSTRUCTIONS;
  const model = env.OPENAI_MODEL?.trim() || "gpt-5-mini";
  const url = "https://api.openai.com/v1/responses";
  try {
    const response = await request(url, {
      // This Worker runtime supports manual/follow only. A 3xx response fails
      // the response.ok check below, so credentials never follow a redirect.
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(45_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY!.trim()}` },
      body: JSON.stringify({ model, instructions, input: text, store: false, max_output_tokens: 3200, reasoning: { effort: "medium" } }),
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
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    };
    const answer = body.status === "completed" ? body.output?.filter(item => item.type === "message").flatMap(item => item.content ?? []).filter(item => item.type === "output_text").map(item => item.text ?? "").join("\n").trim() : "";
    if (!answer) throw new Error("provider returned no complete answer");
    return { provider, model, text: answer };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "ADVISOR_PROVIDER_UNAVAILABLE", `${ADVISOR_PROVIDER_LABELS[provider]} could not complete the analysis. Try again shortly.`);
  }
}

export async function callAdvisor(mode: AdvisorMode, text: string, env: VanteloqRuntimeEnv, request: typeof fetch = fetch, purpose: "analysis" | "help" = "analysis") {
  // Reject legacy or forged modes even when called outside the HTTP handler.
  if (!isAdvisorMode(mode)) throw new ApiError(400, "ADVISOR_PROVIDER_INVALID", "Vanteloq AI supports OpenAI only.");
  const status = advisorProviderStatus(env).openai;
  if (!status.ready) return { configured: false as const, message: status.reason, model: "", text: "", providers: [] };
  const answer = await callProvider("openai", text, env, request, purpose);
  return { configured: true as const, model: answer.model, text: answer.text, providers: [answer.provider], partial: false };
}
