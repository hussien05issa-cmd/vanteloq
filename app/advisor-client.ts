import type { AdvisorMode } from "../domain/advisor-providers";
import { ADVISOR_CONSENT_NOTICE_VERSION, PRIVACY_POLICY_VERSION } from "../domain/privacy-controls";

export type AdvisorRequest = {
  question: string;
  provider: AdvisorMode;
  conversationId: string | null;
  dataUseAccepted: boolean;
  memoryEnabled: boolean;
  locationId?: string | null;
  purpose?: "analysis" | "help";
  from?: string;
  to?: string;
};

/** The signal is transport-only and must never enter the business prompt. */
export function requestAdvisorAnalysis(fetcher: typeof fetch, input: AdvisorRequest, signal?: AbortSignal) {
  return fetcher("/api/v1/advisor/chat", {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, noticeVersion: ADVISOR_CONSENT_NOTICE_VERSION, privacyPolicyVersion: PRIVACY_POLICY_VERSION }),
  });
}

export type AdvisorPayload = { status?: string; answer?: string | null; conversationId?: string | null; message?: string; error?: { code?: string; message?: string } };

/** Bound auth, request and body parsing together, even if a fetcher ignores abort. */
export async function readAdvisorAnswer(fetcher: typeof fetch, input: AdvisorRequest, signal: AbortSignal, timeoutMs = 75_000) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => { controller.abort(); reject(new DOMException("Response stopped.", "AbortError")); };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => { controller.abort(); reject(new DOMException("This reply took too long. Your question is still here. Try again.", "TimeoutError")); }, timeoutMs);
  });
  try {
    return await Promise.race([
      cancelled,
      (async () => {
        if (controller.signal.aborted) throw new DOMException("Response stopped.", "AbortError");
        const response = await requestAdvisorAnalysis(fetcher, input, controller.signal);
        return { response, payload: await response.json() as AdvisorPayload };
      })(),
    ]);
  } finally { clearTimeout(timer); signal.removeEventListener("abort", onAbort); }
}
