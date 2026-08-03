import { eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { findAccessContext } from "../../../../server/authorization";
import {
  ApiError,
  clientSource,
  enforceRateLimit,
  handleApi,
  jsonResponse,
  optionalIdentity,
  readJsonObject,
  requireIdentity,
  requireSameOrigin,
} from "../../../../server/api";
import { onboardingInput } from "../../../../server/validation";

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
    const identity = optionalIdentity(request);
    if (!identity) return jsonResponse({ authenticated: false, organization: null }, { status: 401 });
    const context = await findAccessContext(identity);
    return jsonResponse({
      authenticated: true,
      user: { displayName: identity.displayName },
      role: context?.role ?? null,
      organization: context ? organizationDto(context) : null,
    });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const identity = requireIdentity(request);
    await enforceRateLimit("onboarding:user", identity.email, 5, 3_600);
    const source = clientSource(request);
    if (source !== "unknown") await enforceRateLimit("onboarding:source", source, 20, 3_600);

    const existingAccess = await findAccessContext(identity);
    if (existingAccess) throw new ApiError(409, "WORKSPACE_EXISTS", "This account already belongs to a workspace.");

    const input = onboardingInput(await readJsonObject(request));
    const [existingUser] = await getDb()
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.email, identity.email))
      .limit(1);
    if (existingUser?.status === "suspended") {
      throw new ApiError(403, "ACCOUNT_SUSPENDED", "This account cannot create a workspace.");
    }

    const now = Date.now();
    const userId = existingUser?.id ?? crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    const database = getD1();

    try {
      await database.batch([
        database.prepare(`
          INSERT INTO users (id, email, display_name, status, created_at, updated_at)
          VALUES (?, ?, ?, 'active', ?, ?)
          ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at
        `).bind(userId, identity.email, input.ownerName, now, now),
        database.prepare(`
          INSERT INTO workspaces (
            id, owner_name, business_name, legal_name, business_email, phone, website, industry,
            country, province, city, address, postal_code, timezone, currency, fiscal_year_start,
            tax_number, hours_json, source_mode, selected_pos, setup_complete, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).bind(
          organizationId, input.ownerName, input.businessName, input.legalName, input.businessEmail,
          input.phone, input.website, input.industry, input.country, input.province, input.city,
          input.address, input.postalCode, input.timezone, input.currency, input.fiscalYearStart,
          input.taxNumber, input.hoursJson, input.sourceMode, input.selectedPos, now, now,
        ),
        database.prepare(`
          INSERT INTO memberships (id, user_id, organization_id, role, status, created_at, updated_at)
          VALUES (?, ?, ?, 'owner', 'active', ?, ?)
        `).bind(membershipId, userId, organizationId, now, now),
        database.prepare(`
          INSERT INTO audit_events (
            id, organization_id, actor_user_id, action, resource_type, resource_id,
            outcome, request_id, source_hash, details_json, created_at
          ) VALUES (?, ?, ?, 'workspace.created', 'workspace', ?, 'success', ?, NULL, ?, ?)
        `).bind(auditId, organizationId, userId, organizationId, requestId, JSON.stringify({ sourceMode: input.sourceMode }), now),
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

