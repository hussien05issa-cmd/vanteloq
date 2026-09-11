import type { VanteloqRuntimeEnv } from "../db/index.ts";
import { ADVISOR_PROVIDER_LABELS, advisorProviders, type AdvisorMode, type AdvisorProvider } from "../domain/advisor-providers.ts";
import { ApiError } from "./api.ts";

export function advisorProviderStatus(env: VanteloqRuntimeEnv) {
  return {
    gemini: { ready: Boolean(env.GOOGLE_GEMINI_API_KEY?.trim()) && env.GOOGLE_GEMINI_PAID_SERVICE_CONFIRMED === "true", reason: !env.GOOGLE_GEMINI_API_KEY?.trim() ? "Google Gemini setup is pending." : env.GOOGLE_GEMINI_PAID_SERVICE_CONFIRMED !== "true" ? "Google Gemini business-data protection needs administrator verification." : null },
    openai: { ready: Boolean(env.OPENAI_API_KEY?.trim()), reason: env.OPENAI_API_KEY?.trim() ? null : "OpenAI setup is pending." },
  };
}

async function callProvider(provider: AdvisorProvider, text: string, env: VanteloqRuntimeEnv, request: typeof fetch) {
  const model = provider === "gemini" ? env.VERTEX_AI_MODEL?.trim() || "gemini-2.5-flash" : env.OPENAI_MODEL?.trim() || "gpt-5-mini";
  const url = provider === "gemini" ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` : "https://api.openai.com/v1/responses";
  try {
    const response = await request(url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(45_000),
      headers: provider === "gemini" ? { "content-type": "application/json", "x-goog-api-key": env.GOOGLE_GEMINI_API_KEY!.trim() } : { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY!.trim()}` },
      body: JSON.stringify(provider === "gemini"
        ? { contents: [{ role: "user", parts: [{ text }] }], generationConfig: { temperature: 0.15, maxOutputTokens: 1400 } }
        : { model, input: text, store: false, max_output_tokens: 2400, reasoning: { effort: "low" } }),
    });
    if (!response.ok) throw new Error("provider rejected request");
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
  } catch {
    throw new ApiError(502, "ADVISOR_PROVIDER_UNAVAILABLE", `${ADVISOR_PROVIDER_LABELS[provider]} could not complete the analysis. Try again shortly.`);
  }
}

export async function callAdvisor(mode: AdvisorMode, text: string, env: VanteloqRuntimeEnv, request: typeof fetch = fetch) {
  const providers = advisorProviders(mode);
  const status = advisorProviderStatus(env);
  const blocked = providers.filter(provider => !status[provider].ready);
  // Check every selected provider before sending any customer information.
  if (blocked.length) return { configured: false as const, message: blocked.map(provider => status[provider].reason).join(" "), model: "", text: "", providers: [] };
  const results = await Promise.allSettled(providers.map(provider => callProvider(provider, text, env, request)));
  const completed = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  if (!completed.length) throw new ApiError(502, "ADVISOR_UNAVAILABLE", "Vanteloq AI could not complete the analysis. Try again shortly.");
  const partial = completed.length !== providers.length;
  const answer = mode === "both" ? results.map((result, index) => `${ADVISOR_PROVIDER_LABELS[providers[index]]}\n${result.status === "fulfilled" ? result.value.text : "Analysis unavailable for this request."}`).join("\n\n") : completed[0].text;
  return { configured: true as const, model: completed.map(result => result.model).join(" + "), text: answer, providers: completed.map(result => result.provider), partial };
}
