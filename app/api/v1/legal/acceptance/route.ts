import { getD1 } from "../../../../../db";
import { requirePrivacyAccess } from "../../../../../server/authorization";
import { hasCurrentLegalAcceptance } from "../../../../../server/legal-acceptance";
import {
  ApiError,
  clientSource,
  enforceRateLimit,
  handleApi,
  hashIdentifier,
  jsonResponse,
  readJsonObject,
  requireSameOrigin,
} from "../../../../../server/api";
import {
  ACCOUNT_ACCEPTANCE_NOTICE_VERSION,
  PRIVACY_POLICY_VERSION,
  TERMS_OF_SERVICE_VERSION,
} from "../../../../../shared/legal-versions";

const ROLES = ["owner", "admin", "manager", "employee", "read_only", "integration"] as const;

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requirePrivacyAccess(request, ROLES);
    return jsonResponse({
      accepted: await hasCurrentLegalAcceptance(context.userId),
      termsVersion: TERMS_OF_SERVICE_VERSION,
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      noticeVersion: ACCOUNT_ACCEPTANCE_NOTICE_VERSION,
    });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requirePrivacyAccess(request, ROLES);
    const input = await readJsonObject(request, 2_000);
    if(input.accepted !== true) throw new ApiError(400,"LEGAL_ACCEPTANCE_REQUIRED","Select the agreement checkbox before continuing.");
    if (
      input.termsVersion !== TERMS_OF_SERVICE_VERSION
      || input.privacyPolicyVersion !== PRIVACY_POLICY_VERSION
      || input.noticeVersion !== ACCOUNT_ACCEPTANCE_NOTICE_VERSION
    ) {
      throw new ApiError(409, "LEGAL_VERSION_CHANGED", "This page is out of date. Refresh, review the current policies and accept again.");
    }
    if(await hasCurrentLegalAcceptance(context.userId)) return jsonResponse({accepted:true});
    await enforceRateLimit("legal:acceptance", context.userId, 20, 3_600);
    const source = clientSource(request);
    const sourceHash = source === "unknown" ? null : await hashIdentifier(`legal-source:${source}`);
    const userAgent = request.headers.get("user-agent")?.slice(0, 512) ?? "";
    const userAgentHash = userAgent ? await hashIdentifier(`legal-user-agent:${userAgent}`) : null;
    const now = Date.now();
    await getD1().prepare(`
      INSERT OR IGNORE INTO legal_acceptances (
        id, organization_id, user_id, terms_version, privacy_policy_version,
        notice_version, acceptance_source, source_hash, user_agent_hash,
        request_id, accepted_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'material_policy_update', ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), context.organizationId, context.userId,
      TERMS_OF_SERVICE_VERSION, PRIVACY_POLICY_VERSION, ACCOUNT_ACCEPTANCE_NOTICE_VERSION,
      sourceHash, userAgentHash, requestId, now, now,
    ).run();
    return jsonResponse({ accepted: await hasCurrentLegalAcceptance(context.userId) });
  });
}
