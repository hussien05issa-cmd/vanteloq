import { ApiError, readJsonObject } from "../api";
import type { AccessContext } from "../authorization";
import { reserveIntegrationSelection } from "./free-selection";
import { recordAudit } from "../audit";
import { PRIVACY_POLICY_VERSION } from "../../domain/privacy-controls";
import { providerPrivacy, PROVIDER_PRIVACY_NOTICE_VERSION, validProviderPrivacyAcceptance, type PrivacyProvider } from "../../domain/provider-privacy";

/** Connection acknowledgement is recorded independently of background-sync consent. */
export async function requireProviderPrivacy(request: Request, context: AccessContext, provider: PrivacyProvider, requestId: string) {
  const input = await readJsonObject(request.clone(), 16_000);
  if (!validProviderPrivacyAcceptance(input)) throw new ApiError(400, "PROVIDER_PRIVACY_REQUIRED", "Review and accept the current privacy notice before connecting this provider.");
  await reserveIntegrationSelection(context, provider);
  await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
    action: "integration.privacy_notice_accepted", resourceType: "integration", resourceId: provider,
    details: { provider, noticeVersion: PROVIDER_PRIVACY_NOTICE_VERSION, privacyPolicyVersion: PRIVACY_POLICY_VERSION, providerPolicyUrl: providerPrivacy[provider].url, backgroundSyncAuthorized: false } });
}
