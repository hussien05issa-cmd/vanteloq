import { getD1 } from "../../../../../db";
import { requirePrivacyAccess } from "../../../../../server/authorization";
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

async function hasCurrentAcceptance(userId: string) {
  return Boolean(await getD1().prepare(`
    SELECT id FROM legal_acceptances
    WHERE user_id = ? AND terms_version = ? AND privacy_policy_version = ?
    LIMIT 1
  `).bind(userId, TERMS_OF_SERVICE_VERSION, PRIVACY_POLICY_VERSION).first());
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requirePrivacyAccess(request, ROLES);
    return jsonResponse({
      accepted: await hasCurrentAcceptance(context.userId),
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
    await enforceRateLimit("legal:acceptance", context.userId, 5, 3_600);
    const input = await readJsonObject(request, 2_000);
    if (
      input.accepted !== true
      || input.termsVersion !== TERMS_OF_SERVICE_VERSION
      || input.privacyPolicyVersion !== PRIVACY_POLICY_VERSION
      || input.noticeVersion !== ACCOUNT_ACCEPTANCE_NOTICE_VERSION
    ) {
      throw new ApiError(400, "LEGAL_ACCEPTANCE_REQUIRED", "Review and accept the current Terms of Service and Privacy Policy to continue.");
    }
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
    return jsonResponse({ accepted: await hasCurrentAcceptance(context.userId) });
  });
}
