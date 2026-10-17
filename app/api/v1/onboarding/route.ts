import { normalizeDashboardPreferences } from "../../../../domain/dashboard-preferences";
import { defaultIndustryConfiguration, validateIndustryConfiguration, resolveIndustryTemplate } from "../../../../domain/industry-templates";
import { initialIndustryStatement } from "../../../../server/industry-configuration";
import { eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { memberships, users } from "../../../../db/schema";
import { findAccessContext } from "../../../../server/authorization";
import {
  ApiError,
  clientSource,
  enforceRateLimit,
  handleApi,
  hashIdentifier,
  jsonResponse,
  optionalIdentity,
  readJsonObject,
  requireAal2,
  requireIdentity,
  requireSameOrigin,
} from "../../../../server/api";
import { checkoutOnboardingInput, onboardingInput } from "../../../../server/validation";
import { getTenantEntitlements, requireTenantServiceAccess } from "../../../../server/entitlements/engine";
import { bootstrapSupabaseOrganization } from "../../../../server/supabase";
import { onboardingIdentityDisposition } from "../../../../server/onboarding-identity";
import { pendingComplimentaryOffer, complimentarySetupInput } from "../../../../server/complimentary-access";
import { pendingTeamInvitation } from "../../../../server/team-invitations";

function organizationDto(context: NonNullable<Awaited<ReturnType<typeof findAccessContext>>>) {
  return {
    id: context.organizationId,
    businessName: context.organization.businessName,
    ownerName: context.organization.ownerName,
    industry: context.organization.industry,
    timezone: context.organization.timezone,
    currency: context.organization.currency,
    sourceMode: context.organization.sourceMode,
    selectedPos: context.organization.selectedPos,
    setupComplete: context.organization.setupComplete,
  };
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const identity = await optionalIdentity(request);
    if (!identity) return jsonResponse({ authenticated: false, organization: null }, { status: 401 });
    const invitation = await pendingTeamInvitation(request, identity);
    const context = invitation ? null : await findAccessContext(identity, request);
    if (!context && !invitation) {
      const occupied = await getD1().prepare(`SELECT u.auth_subject, u.auth_provider, u.status,
        EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id) AS has_membership
        FROM users u WHERE u.email=? LIMIT 1`).bind(identity.email)
        .first<{auth_subject:string|null;auth_provider:"supabase"|"sites"|null;status:"active"|"suspended";has_membership:number}>();
      if (occupied?.has_membership) onboardingIdentityDisposition({ existingStatus: occupied.status,
        existingAuthSubject: occupied.auth_subject, existingAuthProvider: occupied.auth_provider,
        hasMembership: true, identity });
    }
    return jsonResponse({
      authenticated: true,
      user: { displayName: identity.displayName, email: identity.email, emailVerified: true },
      role: context?.role ?? null,
      organization: context ? organizationDto(context) : null,
      invitation,
      complimentary: !context && !invitation ? await pendingComplimentaryOffer(identity) : null,
    });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const identity = await requireIdentity(request);
    requireAal2(identity);
    const deletionHash = await hashIdentifier(`vanteloq-account:${identity.subject}`);
    const deleting = await getD1().prepare("SELECT id FROM account_deletion_jobs WHERE account_hash = ? AND stage <> 'completed' LIMIT 1").bind(deletionHash).first();
    if (deleting) throw new ApiError(409, "DELETION_IN_PROGRESS", "Finish the saved deletion session before creating another workspace.");
    await enforceRateLimit("onboarding:user", identity.email, 5, 3_600);
    const source = clientSource(request);
    if (source !== "unknown") await enforceRateLimit("onboarding:source", source, 20, 3_600);
    const sourceHash = source === "unknown" ? null : await hashIdentifier(`legal-source:${source}`);
    const userAgent = request.headers.get("user-agent")?.slice(0, 512) ?? "";
    const userAgentHash = userAgent ? await hashIdentifier(`legal-user-agent:${userAgent}`) : null;

    const invitation = await pendingTeamInvitation(request, identity);
    if (invitation) throw new ApiError(409, "TEAM_INVITATION_REQUIRED", "Accept your company invitation instead of creating a separate workspace.");
    const body = await readJsonObject(request);
    const checkoutStage = body.stage === "checkout";
    const existingAccess = await findAccessContext(identity, request);
    if (existingAccess) {
      if (checkoutStage) return jsonResponse({ organization: organizationDto(existingAccess), role: existingAccess.role });
      if (existingAccess.organization.setupComplete) throw new ApiError(409, "WORKSPACE_EXISTS", "Your workspace already exists. Reload this page to continue to it.");
      if (existingAccess.role !== "owner") throw new ApiError(403, "INSUFFICIENT_PERMISSION", "Only the workspace owner can finish setup.");
      requireTenantServiceAccess(await getTenantEntitlements(existingAccess));
    }
    const complimentary = typeof body.complimentaryId === "string" ? await pendingComplimentaryOffer(identity) : null;
    if (body.complimentaryId !== undefined && !complimentary) throw new ApiError(403, "INVITATION_INVALID", "This invitation is not available for this account.");
    const input = complimentary ? complimentarySetupInput(body, identity, complimentary)
      : checkoutStage ? checkoutOnboardingInput(body, identity) : onboardingInput(body);
    let industryConfiguration = defaultIndustryConfiguration(input.industry);
    if (!checkoutStage && !complimentary && body.industryConfiguration !== undefined) {
      try { industryConfiguration=validateIndustryConfiguration(body.industryConfiguration,input.industry); }
      catch(error) { throw new ApiError(400,"INDUSTRY_INVALID",error instanceof Error?error.message:"Review the business configuration."); }
    }
    const [existingUser] = await getDb()
      .select({ id: users.id, status: users.status, authSubject: users.authSubject, authProvider: users.authProvider })
      .from(users)
      .where(existingAccess ? eq(users.id, existingAccess.userId) : eq(users.email, identity.email))
      .limit(1);
    const [existingMembership] = existingUser
      ? await getDb()
        .select({
          id: memberships.id,
          organizationId: memberships.organizationId,
          role: memberships.role,
          status: memberships.status,
        })
        .from(memberships)
        .where(eq(memberships.userId, existingUser.id))
        .limit(1)
      : [];
    const identityDisposition = existingAccess ? "reuse" : onboardingIdentityDisposition({
      existingStatus: existingUser?.status ?? null,
      existingAuthSubject: existingUser?.authSubject ?? null,
      existingAuthProvider: existingUser?.authProvider ?? null,
      hasMembership: Boolean(existingMembership),
      identity,
    });

    // Onboarding accepts a validated form entry without a third-party lookup.
    // An entered address is never represented as independently verified.
    const businessAddress = {
      address: input.address,
      city: input.city,
      province: input.province,
      postalCode: input.postalCode,
      country: input.country,
      validationStatus: "entered" as const,
    };

    try {
      if (!checkoutStage) await bootstrapSupabaseOrganization(request, input.businessName, identity.subject);
    } catch {
      throw new ApiError(503, "ACCOUNT_DATA_UNAVAILABLE", "Secure account setup is temporarily unavailable.");
    }

    const now = Date.now();
    const database = getD1();
    const persistedUser = existingAccess ? await database.prepare(`SELECT id,status FROM users
      WHERE id=? AND auth_subject=?`)
      .bind(existingAccess.userId, identity.subject).first<{id:string;status:"active"|"suspended"}>()
      : await database.prepare(`
      INSERT INTO users (id, email, auth_subject, auth_provider, display_name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        auth_subject = excluded.auth_subject,
        auth_provider = excluded.auth_provider,
        display_name = excluded.display_name,
        updated_at = excluded.updated_at
      RETURNING id, status
    `).bind(existingUser?.id ?? identity.subject ?? crypto.randomUUID(), identity.email, identity.subject, identity.provider, input.ownerName, now, now)
      .first<{ id: string; status: "active" | "suspended" }>();
    if (!persistedUser) {
      throw new ApiError(503, "DATABASE_UNAVAILABLE", "Account setup is temporarily unavailable.");
    }
    if (persistedUser.status === "suspended") {
      throw new ApiError(403, "ACCOUNT_SUSPENDED", "This account cannot create a workspace.");
    }

    const userId = persistedUser.id;
    const stableIdentityHash = (await hashIdentifier(`onboarding:${userId}`)).slice(0, 32);
    const organizationId = existingAccess?.organizationId ?? `workspace-${stableIdentityHash}`;
    const membershipId = `membership-${stableIdentityHash}`;
    const auditId = `audit-workspace-${checkoutStage ? "prepared" : "created"}-${stableIdentityHash}`;
    const legalAcceptanceId = `legal-${stableIdentityHash}-${input.termsVersion}`;
    const primaryLocationId = `${organizationId}:location:primary`;

    try {
      // D1 batches commit statements sequentially. Stable identifiers and
      // convergent upserts make a retry safe if execution stops partway through.
      // The audit row precedes membership activation so visible access is never
      // granted without the corresponding creation record.
      const subjectHash = complimentary ? await hashIdentifier(`complimentary-subject:${identity.subject}`) : null;
      await database.batch([
        database.prepare(`
          INSERT INTO workspaces (
            id, owner_name, business_name, legal_name, business_email, phone, website, industry,
            country, province, city, address, postal_code, timezone, currency, fiscal_year_start,
            tax_number, hours_json, source_mode, selected_pos, setup_complete, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            owner_name = excluded.owner_name,
            business_name = excluded.business_name,
            legal_name = excluded.legal_name,
            business_email = excluded.business_email,
            phone = excluded.phone,
            website = excluded.website,
            industry = excluded.industry,
            country = excluded.country,
            province = excluded.province,
            city = excluded.city,
            address = excluded.address,
            postal_code = excluded.postal_code,
            timezone = excluded.timezone,
            currency = excluded.currency,
            fiscal_year_start = excluded.fiscal_year_start,
            tax_number = excluded.tax_number,
            hours_json = excluded.hours_json,
            source_mode = excluded.source_mode,
            selected_pos = excluded.selected_pos,
            setup_complete = excluded.setup_complete,
            updated_at = excluded.updated_at
          WHERE workspaces.setup_complete = 0 AND excluded.setup_complete = 1
        `).bind(
          organizationId, input.ownerName, input.businessName, input.legalName, input.businessEmail,
          input.phone, input.website, input.industry, businessAddress.country, businessAddress.province, businessAddress.city,
          businessAddress.address, businessAddress.postalCode, input.timezone, input.currency, input.fiscalYearStart,
          input.taxNumber, input.hoursJson, input.sourceMode, input.selectedPos, checkoutStage ? 0 : 1, now, now,
        ),
        ...(!checkoutStage ? [database.prepare("DELETE FROM onboarding_drafts WHERE user_id=?").bind(userId),initialIndustryStatement(organizationId,userId,industryConfiguration,resolveIndustryTemplate(industryConfiguration.templateId).label,now),database.prepare(`
          INSERT OR IGNORE INTO organization_locations (
            id, organization_id, name, status, country_code, address_line_1,
            address_line_2, address_line_3, locality, district, administrative_area,
            postal_code, timezone, currency, locale, tax_jurisdiction,
            validation_status, created_at, updated_at
          ) VALUES (?, ?, 'Primary location', 'active', ?, ?, '', '', ?, '', ?, ?, ?, ?, ?, '', ?, ?, ?)
        `).bind(
          primaryLocationId, organizationId, businessAddress.country, businessAddress.address, businessAddress.city,
          businessAddress.province, businessAddress.postalCode, input.timezone, input.currency,
          businessAddress.country === "US" ? "en-US" : "en-CA", businessAddress.validationStatus, now, now,
        )] : []),
        database.prepare(`
          INSERT OR IGNORE INTO legal_acceptances (
            id, organization_id, user_id, terms_version, privacy_policy_version,
            notice_version, acceptance_source, source_hash, user_agent_hash,
            request_id, accepted_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'onboarding_review', ?, ?, ?, ?, ?)
        `).bind(
          legalAcceptanceId, organizationId, userId, input.termsVersion,
          input.privacyPolicyVersion, input.legalNoticeVersion, sourceHash,
          userAgentHash, requestId, now, now,
        ),
        database.prepare(`
          INSERT OR IGNORE INTO audit_events (
            id, organization_id, actor_user_id, action, resource_type, resource_id,
            outcome, request_id, source_hash, details_json, created_at
          ) VALUES (?, ?, ?, ?, 'workspace', ?, 'success', ?, NULL, ?, ?)
        `).bind(auditId, organizationId, userId, checkoutStage ? 'workspace.checkout_prepared' : 'workspace.created', organizationId, requestId, JSON.stringify({
          sourceMode: input.sourceMode,
          legalAcceptanceId,
          identityDisposition,
          addressValidationStatus: complimentary ? "not_provided" : businessAddress.validationStatus,
          complimentaryGrantId: complimentary?.id ?? null,
        }), now),
        ...(!checkoutStage ? [database.prepare(`
          INSERT INTO account_preferences (
            user_id, email_notifications, remembered_profile, hidden_navigation_json,
            preferred_location_id, created_at, updated_at, dashboard_preferences_json
          ) VALUES (?, ?, 1, '[]', ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            dashboard_preferences_json = excluded.dashboard_preferences_json,
            email_notifications = excluded.email_notifications,
            remembered_profile = 1,
            preferred_location_id = COALESCE(account_preferences.preferred_location_id, excluded.preferred_location_id),
            updated_at = excluded.updated_at
        `).bind(userId, input.emailNotifications ? 1 : 0, primaryLocationId, now, now, JSON.stringify({workspaceId:organizationId,dashboard:normalizeDashboardPreferences(body.dashboardPreferences)})),
        database.prepare(`
          INSERT OR IGNORE INTO account_notifications (
            id, user_id, organization_id, notification_type, title, message, delivery_status, created_at
          ) VALUES (?, ?, ?, 'workspace_created', 'Workspace created', ?, 'in_app', ?)
        `).bind(`notification-workspace-created-${stableIdentityHash}`, userId, organizationId, `${input.businessName} is ready. Your verified account, preferences and workspace history are stored securely.`, now)] : []),
        ...(complimentary ? [
          database.prepare("INSERT INTO complimentary_access (grant_id,user_id,organization_id,auth_subject_hash,active,created_at) VALUES (?,?,?,?,1,?)")
            .bind(complimentary.id, userId, organizationId, subjectHash, now),
          database.prepare("INSERT INTO audit_events (id,organization_id,actor_user_id,action,resource_type,resource_id,outcome,request_id,details_json,created_at) VALUES (?,?,?,'complimentary_access.accepted','complimentary_access',?,'success',?,?,?)")
            .bind("audit-complimentary-" + complimentary.id, organizationId, userId, complimentary.id, requestId,
              JSON.stringify({ plan: complimentary.plan, bookloq: complimentary.bookloq, expiresAt: complimentary.expiresAt, source: "operator_configured_invitation", legalAcceptanceId }), now),
        ] : []),
        database.prepare(`
          INSERT INTO memberships (id, user_id, organization_id, role, status, created_at, updated_at)
          VALUES (?, ?, ?, 'owner', 'active', ?, ?)
          ON CONFLICT(user_id) DO NOTHING
        `).bind(membershipId, userId, organizationId, now, now),
      ]);
    } catch (error) {
      if (error instanceof Error && /unique|constraint/i.test(error.message)) {
        throw new ApiError(409, "WORKSPACE_EXISTS", "This account already belongs to a workspace.");
      }
      throw error;
    }

    // Return the persisted winner if two setup submissions arrive together.
    const saved = await findAccessContext(identity, request);
    if (!saved || saved.organizationId !== organizationId) throw new ApiError(503, "SETUP_RETRY_REQUIRED", "Your setup was saved. Reload this page to continue securely.");
    if (!checkoutStage) await database.prepare("UPDATE users SET display_name=?,updated_at=? WHERE id=?")
      .bind(saved.organization.ownerName, now, saved.userId).run();
    return jsonResponse({ organization: organizationDto(saved), role: saved.role }, { status: 201 });
  });
}
