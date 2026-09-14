import { requirePrivacyAccess } from "../../../../../server/authorization";
import { ApiError, clientSource, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../server/api";
import { advisorConsentStatus, recordAdvisorConsent, withdrawAdvisorConsent } from "../../../../../server/privacy";
import { recordAudit } from "../../../../../server/audit";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requirePrivacyAccess(request, readers);
    return jsonResponse({ consent: await advisorConsentStatus(context.organizationId, context.userId) });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const context = await requirePrivacyAccess(request, readers);
    await enforceRateLimit("advisor:consent", `${context.userId}:${clientSource(request)}`, 20, 60);
    const body = await readJsonObject(request, 1000);
    if (body.accepted !== true || (body.purpose !== "analysis" && body.purpose !== "help"))
      throw new ApiError(400, "ADVISOR_CONSENT_INVALID", "Choose whether to allow the data use described in this notice.");
    await recordAdvisorConsent({
      provider: "openai", purpose: body.purpose, organizationId: context.organizationId, actorUserId: context.userId,
      noticeVersion: typeof body.noticeVersion === "string" ? body.noticeVersion : "",
      privacyPolicyVersion: typeof body.privacyPolicyVersion === "string" ? body.privacyPolicyVersion : "",
    });
    return jsonResponse({ consent: await advisorConsentStatus(context.organizationId, context.userId) });
  });
}

export async function DELETE(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requirePrivacyAccess(request, readers);
    await enforceRateLimit("advisor:withdraw-consent", `${context.userId}:${clientSource(request)}`, 10, 60);
    await withdrawAdvisorConsent(context.organizationId, context.userId);
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "privacy.advisor_consent_withdrawn", resourceType: "integration_consent", resourceId: context.userId });
    return jsonResponse({ consent: { analysis: false, help: false } });
  });
}
