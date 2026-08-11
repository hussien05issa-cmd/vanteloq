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
import { onboardingInput } from "../../../../server/validation";
import { bootstrapSupabaseOrganization } from "../../../../server/supabase";

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
    const context = await findAccessContext(identity);
    return jsonResponse({
      authenticated: true,
      user: { displayName: identity.displayName, email: identity.email, emailVerified: true },
      role: context?.role ?? null,
      organization: context ? organizationDto(context) : null,
    });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const identity = await requireIdentity(request);
    requireAal2(identity);
    await enforceRateLimit("onboarding:user", identity.email, 5, 3_600);
    const source = clientSource(request);
    if (source !== "unknown") await enforceRateLimit("onboarding:source", source, 20, 3_600);

    const existingAccess = await findAccessContext(identity);
    if (existingAccess) throw new ApiError(409, "WORKSPACE_EXISTS", "This account already belongs to a workspace.");

    const input = onboardingInput(await readJsonObject(request));
    try {
      await bootstrapSupabaseOrganization(request, input.businessName, identity.subject);
    } catch {
      throw new ApiError(503, "ACCOUNT_DATA_UNAVAILABLE", "Secure account setup is temporarily unavailable.");
    }
    const [existingUser] = await getDb()
      .select({ id: users.id, status: users.status, authSubject: users.authSubject, authProvider: users.authProvider })
      .from(users)
      .where(eq(users.email, identity.email))
      .limit(1);
    if (existingUser?.status === "suspended") {
      throw new ApiError(403, "ACCOUNT_SUSPENDED", "This account cannot create a workspace.");
    }
    if (identity.provider === "supabase" && existingUser?.authSubject && (
      existingUser.authSubject !== identity.subject || existingUser.authProvider !== "supabase"
    )) {
      throw new ApiError(403, "IDENTITY_CONFLICT", "This verified identity does not match the existing Vanteloq account.");
    }
    if (existingUser) {
      const [existingMembership] = await getDb()
        .select({ id: memberships.id })
        .from(memberships)
        .where(eq(memberships.userId, existingUser.id))
        .limit(1);
      if (existingMembership) {
        throw new ApiError(409, "WORKSPACE_EXISTS", "This account already belongs to a workspace.");
      }
    }

    const now = Date.now();
    const database = getD1();
    const persistedUser = await database.prepare(`
      INSERT INTO users (id, email, auth_subject, auth_provider, display_name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        auth_subject = COALESCE(users.auth_subject, excluded.auth_subject),
        auth_provider = COALESCE(users.auth_provider, excluded.auth_provider),
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
    const organizationId = `workspace-${stableIdentityHash}`;
    const membershipId = `membership-${stableIdentityHash}`;
    const auditId = `audit-workspace-created-${stableIdentityHash}`;
    const primaryLocationId = `${organizationId}:location:primary`;

    try {
      // D1 batches commit statements sequentially. Stable identifiers and
      // convergent upserts make a retry safe if execution stops partway through.
      // The audit row precedes membership activation so visible access is never
      // granted without the corresponding creation record.
      await database.batch([
        database.prepare(`
          INSERT INTO workspaces (
            id, owner_name, business_name, legal_name, business_email, phone, website, industry,
            country, province, city, address, postal_code, timezone, currency, fiscal_year_start,
            tax_number, hours_json, source_mode, selected_pos, setup_complete, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
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
            setup_complete = 1,
            updated_at = excluded.updated_at
        `).bind(
          organizationId, input.ownerName, input.businessName, input.legalName, input.businessEmail,
          input.phone, input.website, input.industry, input.country, input.province, input.city,
          input.address, input.postalCode, input.timezone, input.currency, input.fiscalYearStart,
          input.taxNumber, input.hoursJson, input.sourceMode, input.selectedPos, now, now,
        ),
        database.prepare(`
          INSERT OR IGNORE INTO organization_locations (
            id, organization_id, name, status, country_code, address_line_1,
            address_line_2, address_line_3, locality, district, administrative_area,
            postal_code, timezone, currency, locale, tax_jurisdiction,
            validation_status, created_at, updated_at
          ) VALUES (?, ?, 'Primary location', 'active', ?, ?, '', '', ?, '', ?, ?, ?, ?, ?, '', 'entered', ?, ?)
        `).bind(
          primaryLocationId, organizationId, input.country, input.address, input.city,
          input.province, input.postalCode, input.timezone, input.currency,
          input.country === "US" ? "en-US" : "en-CA", now, now,
        ),
        database.prepare(`
          INSERT OR IGNORE INTO audit_events (
            id, organization_id, actor_user_id, action, resource_type, resource_id,
            outcome, request_id, source_hash, details_json, created_at
          ) VALUES (?, ?, ?, 'workspace.created', 'workspace', ?, 'success', ?, NULL, ?, ?)
        `).bind(auditId, organizationId, userId, organizationId, requestId, JSON.stringify({ sourceMode: input.sourceMode }), now),
        database.prepare(`
          INSERT INTO account_preferences (
            user_id, email_notifications, remembered_profile, hidden_navigation_json,
            preferred_location_id, created_at, updated_at
          ) VALUES (?, ?, 1, '[]', ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            email_notifications = excluded.email_notifications,
            remembered_profile = 1,
            preferred_location_id = COALESCE(account_preferences.preferred_location_id, excluded.preferred_location_id),
            updated_at = excluded.updated_at
        `).bind(userId, input.emailNotifications ? 1 : 0, primaryLocationId, now, now),
        database.prepare(`
          INSERT OR IGNORE INTO account_notifications (
            id, user_id, organization_id, notification_type, title, message, delivery_status, created_at
          ) VALUES (?, ?, ?, 'workspace_created', 'Workspace created', ?, 'in_app', ?)
        `).bind(`notification-workspace-created-${stableIdentityHash}`, userId, organizationId, `${input.businessName} is ready. Your verified account, preferences and workspace history are stored securely.`, now),
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

    return jsonResponse({
      organization: {
        id: organizationId,
        businessName: input.businessName,
        ownerName: input.ownerName,
        industry: input.industry,
        timezone: input.timezone,
        currency: input.currency,
        sourceMode: input.sourceMode,
        selectedPos: input.selectedPos,
        setupComplete: true,
      },
      role: "owner",
    }, { status: 201 });
  });
}
