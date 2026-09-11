import type { AdvisorMode } from "../domain/advisor-providers";
import { GEMINI_CONSENT_NOTICE_VERSION, PRIVACY_POLICY_VERSION } from "../domain/privacy-controls";

/** Keep provider routing and its consent receipt in the same request. */
export function requestAdvisorAnalysis(fetcher: typeof fetch, input: {
  question: string;
  provider: AdvisorMode;
  conversationId: string | null;
  dataUseAccepted: boolean;
  memoryEnabled: boolean;
  locationId?: string | null;
  purpose?: "analysis" | "help";
}) {
  return fetcher("/api/v1/advisor/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, noticeVersion: GEMINI_CONSENT_NOTICE_VERSION, privacyPolicyVersion: PRIVACY_POLICY_VERSION }),
  });
}
