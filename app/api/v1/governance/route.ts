import { and, asc, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { accountPreferences, accessRoles, organizationLocations, organizationProfiles, teamMembers, users } from "../../../../db/schema";
import { recordAudit } from "../../../../server/audit";
import { requireAccess } from "../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../server/api";
import { allPermissions, permissionCatalogDto, roleTemplates } from "../../../../server/permissions";
import { hashPin, validateTemporaryPin } from "../../../../server/pin";
import { canAddLocation, canAddUser } from "../../../../server/entitlements/engine";

const managers = ["owner", "admin"] as const;
const readers = ["owner", "admin"] as const;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
const PHONE = /^[0-9+().\-\s]{0,30}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const roleLabels: Record<string, [string, string, string]> = {
  account_owner: ["Account Owner", "Protected ownership and full organization control", "#173f6b"],
  organization_administrator: ["Organization Administrator", "Organization-wide administration without ownership transfer", "#2468b4"],
  finance_administrator: ["Finance Administrator", "Banking, accounting, cash and financial reporting", "#386b5c"],
  accountant_bookkeeper: ["Accountant or Bookkeeper", "Accounting records, reports and month-end work", "#66724e"],
  general_manager: ["General Manager", "Operations, team, sales, inventory and purchasing", "#6c5c8f"],
  location_manager: ["Location Manager", "Operational access limited to assigned locations", "#7b6848"],
  inventory_purchasing_manager: ["Inventory and Purchasing Manager", "Inventory, suppliers, receiving and purchase orders", "#357a75"],
  marketing_manager: ["Marketing Manager", "Customer and campaign performance without banking access", "#7b5473"],
  team_lead: ["Team Lead", "Assigned work, team coordination and operational records", "#6a7684"],
  employee: ["Employee", "Least-privilege workplace access", "#607388"],
  external_advisor: ["External Advisor", "Limited professional review access", "#765f5f"],
  read_only_reviewer: ["Read-Only Reviewer", "View-only access to approved records", "#777d86"],
};

function string(value: unknown, label: string, maximum: number, required = true): string {
  if (value === undefined || value === null || value === "") {
    if (!required) return "";
    throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  }
  if (typeof value !== "string") throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  const normalized = value.trim().normalize("NFC");
  if ((required && !normalized) || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) throw new ApiError(400, "INVALID_FIELD", `Enter a valid ${label}.`);
  return normalized;
}

function boolean(value: unknown): boolean { return value === true; }
function jsonArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 100) : []; }

async function bootstrap(organizationId: string, userId: string, ownerName: string, businessName: string, country: string, province: string, city: string, address: string, postalCode: string, timezone: string, currency: string) {
  const now = Date.now();
  const database = getD1();
  const roleStatements = Object.entries(roleTemplates).map(([key, permissions]) => {
    const [name, description, color] = roleLabels[key];
    return database.prepare(`INSERT OR IGNORE INTO access_roles
      (id, organization_id, name, description, color, system_key, permissions_json, location_scope_json, archived, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 0, ?, ?, ?)`)
      .bind(`${organizationId}:role:${key}`, organizationId, name, description, color, key, JSON.stringify(permissions), userId, now, now);
  });
  const parts = ownerName.trim().split(/\s+/);
  const firstName = parts.shift() || "Account";
  const lastName = parts.join(" ") || "Owner";
  await database.batch([
    database.prepare(`INSERT OR IGNORE INTO organization_profiles
      (organization_id, display_name, organization_type, business_structure, locale, language, brand_color, logo_alt_text, logo_version, created_at, updated_at)
      VALUES (?, ?, 'business', '', ?, 'en', '#2368c4', 'Organization logo', 0, ?, ?)`)
      .bind(organizationId, businessName, country === "US" ? "en-US" : "en-CA", now, now),
    database.prepare(`INSERT OR IGNORE INTO organization_locations
      (id, organization_id, name, status, country_code, address_line_1, address_line_2, address_line_3, locality, district, administrative_area, postal_code, timezone, currency, locale, tax_jurisdiction, validation_status, created_at, updated_at)
      VALUES (?, ?, 'Primary location', 'active', ?, ?, '', '', ?, '', ?, ?, ?, ?, ?, '', 'entered', ?, ?)`)
      .bind(`${organizationId}:location:primary`, organizationId, country, address, city, province, postalCode, timezone, currency, country === "US" ? "en-US" : "en-CA", now, now),
    ...roleStatements,
    database.prepare(`INSERT OR IGNORE INTO team_members
      (id, organization_id, user_id, role_id, first_name, last_name, preferred_name, email, mobile, employee_code, job_title, department, employment_type, start_date, permitted_locations_json, status, remote_login, require_mfa, pin_enabled, notes, created_by_user_id, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, email, '', 'OWNER', 'Account Owner', 'Executive', 'owner', date('now'), ?, 'active', 1, 1, 0, '', ?, ?, ? FROM users WHERE id = ?`)
      .bind(`${organizationId}:member:owner`, organizationId, userId, `${organizationId}:role:account_owner`, firstName, lastName, ownerName, JSON.stringify([`${organizationId}:location:primary`]), userId, now, now, userId),
  ]);
}

async function responseBody(context: Awaited<ReturnType<typeof requireAccess>>) {
  await bootstrap(context.organizationId, context.userId, context.organization.ownerName, context.organization.businessName, context.organization.country, context.organization.province, context.organization.city, context.organization.address, context.organization.postalCode, context.organization.timezone, context.organization.currency);
  const [profile] = await getDb().select().from(organizationProfiles).where(eq(organizationProfiles.organizationId, context.organizationId)).limit(1);
  const [preferences] = await getDb().select().from(accountPreferences).where(eq(accountPreferences.userId, context.userId)).limit(1);
  const [account] = await getDb().select({ displayName: users.displayName, email: users.email }).from(users).where(eq(users.id, context.userId)).limit(1);
  const locations = await getDb().select().from(organizationLocations).where(eq(organizationLocations.organizationId, context.organizationId)).orderBy(asc(organizationLocations.name));
  const roles = await getDb().select().from(accessRoles).where(and(eq(accessRoles.organizationId, context.organizationId), eq(accessRoles.archived, false))).orderBy(asc(accessRoles.name));
  const members = await getDb().select().from(teamMembers).where(eq(teamMembers.organizationId, context.organizationId)).orderBy(asc(teamMembers.firstName));
  return {
    account: { ...account, emailVerified: true, authenticationProvider: "ChatGPT secure sign-in" },
    organization: { ...context.organization, displayName: profile?.displayName ?? context.organization.businessName, organizationType: profile?.organizationType ?? "business", businessStructure: profile?.businessStructure ?? "", locale: profile?.locale ?? "en-CA", language: profile?.language ?? "en", brandColor: profile?.brandColor ?? "#2368c4", logoAvailable: Boolean(profile?.logoObjectKey), logoVersion: profile?.logoVersion ?? 0 },
    preferences: preferences ?? { emailNotifications: true, rememberedProfile: true, hiddenNavigationJson: "[]", preferredLocationId: null },
    locations,
    roles: roles.map((role) => ({ ...role, permissions: jsonArray(JSON.parse(role.permissionsJson)) })),
    members: members.map((member) => ({ ...member, permittedLocations: jsonArray(JSON.parse(member.permittedLocationsJson)) })),
    permissionCatalog: permissionCatalogDto(),
    security: {
      password: "Managed by ChatGPT secure sign-in",
      mfa: "Managed by the authenticated identity provider",
      passkeys: "Managed by the authenticated identity provider",
      sessions: "Use sign out to end this Vanteloq session; provider-wide session management remains in the identity service.",
      invitationDelivery: "Email invitation delivery is not configured. New employee profiles remain Draft until a verified delivery provider is connected.",
    },
    billingCoverage: {
      payer: "organization_owner",
      employeeCheckoutRequired: false,
      remoteSeatsEnforced: true,
    },
  };
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers);
    await enforceRateLimit("governance:read", context.userId, 90, 60);
    return jsonResponse(await responseBody(context));
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, managers);
    await enforceRateLimit("governance:write", context.userId, 40, 3_600);
    await bootstrap(context.organizationId, context.userId, context.organization.ownerName, context.organization.businessName, context.organization.country, context.organization.province, context.organization.city, context.organization.address, context.organization.postalCode, context.organization.timezone, context.organization.currency);
    const input = await readJsonObject(request, 128_000);
    const action = string(input.action, "action", 60);
    const database = getD1();
    const now = Date.now();
    let resourceType = "governance";
    let resourceId: string | null = null;
    let details: Record<string, string | number | boolean | null> = { action };

    if (action === "update_profile") {
      const displayName = string(input.displayName, "display name", 120);
      const jobTitle = string(input.jobTitle, "job title", 100, false);
      await database.batch([
        database.prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?").bind(displayName, now, context.userId),
        database.prepare("UPDATE team_members SET preferred_name = ?, job_title = ?, updated_at = ? WHERE organization_id = ? AND user_id = ?").bind(displayName, jobTitle, now, context.organizationId, context.userId),
        database.prepare(`INSERT INTO account_preferences (user_id, email_notifications, remembered_profile, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email_notifications = excluded.email_notifications, remembered_profile = excluded.remembered_profile, updated_at = excluded.updated_at`)
          .bind(context.userId, boolean(input.emailNotifications) ? 1 : 0, input.rememberedProfile !== false ? 1 : 0, now, now),
      ]);
      resourceType = "user_profile"; resourceId = context.userId;
    } else if (action === "update_organization") {
      const displayName = string(input.displayName, "display name", 120);
      const legalName = string(input.legalName, "legal name", 160);
      const businessEmail = string(input.businessEmail, "business email", 254).toLowerCase();
      if (!EMAIL.test(businessEmail)) throw new ApiError(400, "INVALID_FIELD", "Enter a valid business email.");
      const phone = string(input.phone, "phone", 30, false); if (!PHONE.test(phone)) throw new ApiError(400, "INVALID_FIELD", "Enter a valid phone number.");
      const organizationType = string(input.organizationType, "organization type", 80, false) || "business";
      const businessStructure = string(input.businessStructure, "business structure", 100, false);
      const brandColor = string(input.brandColor, "brand colour", 7); if (!/^#[0-9a-f]{6}$/i.test(brandColor)) throw new ApiError(400, "INVALID_FIELD", "Enter a valid six-digit brand colour.");
      await database.batch([
        database.prepare("UPDATE workspaces SET business_name = ?, legal_name = ?, business_email = ?, phone = ?, updated_at = ? WHERE id = ?").bind(displayName, legalName, businessEmail, phone, now, context.organizationId),
        database.prepare("UPDATE organization_profiles SET display_name = ?, organization_type = ?, business_structure = ?, brand_color = ?, updated_at = ? WHERE organization_id = ?").bind(displayName, organizationType, businessStructure, brandColor, now, context.organizationId),
      ]);
      resourceType = "organization"; resourceId = context.organizationId; details = { action, displayName };
    } else if (action === "create_location") {
      const capacity = await canAddLocation(context);
      if (!capacity.allowed) {
        throw new ApiError(409, "LOCATION_LIMIT_REACHED", capacity.reason === "subscription_required"
          ? "An active owner subscription is required before another location can be added."
          : `The owner plan includes ${capacity.limit} locations. Manage the organization plan before adding another location.`);
      }
      const id = crypto.randomUUID();
      const countryCode = string(input.countryCode, "country", 2).toUpperCase();
      const currency = string(input.currency, "currency", 3).toUpperCase();
      await database.prepare(`INSERT INTO organization_locations
        (id, organization_id, name, status, country_code, address_line_1, address_line_2, address_line_3, locality, district, administrative_area, postal_code, timezone, currency, locale, tax_jurisdiction, validation_status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'entered', ?, ?)`)
        .bind(id, context.organizationId, string(input.name, "location name", 120), countryCode, string(input.addressLine1, "address", 180), string(input.addressLine2, "address line 2", 180, false), string(input.addressLine3, "address line 3", 180, false), string(input.locality, "locality", 100), string(input.district, "district", 100, false), string(input.administrativeArea, "administrative area", 100), string(input.postalCode, "postal code", 20, false), string(input.timezone, "timezone", 80), currency, string(input.locale, "locale", 20), string(input.taxJurisdiction, "tax jurisdiction", 100, false), now, now).run();
      resourceType = "location"; resourceId = id;
    } else if (action === "create_employee") {
      const id = crypto.randomUUID();
      const remoteLogin = boolean(input.remoteLogin);
      if (remoteLogin) {
        const capacity = await canAddUser(context);
        if (!capacity.allowed) {
          throw new ApiError(409, "TEAM_SEAT_LIMIT_REACHED", capacity.reason === "subscription_required"
            ? "An active owner subscription is required before remote employee access can be added."
            : `The owner plan includes ${capacity.limit} remote seats. Manage the organization plan before adding another remote login.`);
        }
      }
      const email = string(input.email, "employee email", 254).toLowerCase(); if (!EMAIL.test(email)) throw new ApiError(400, "INVALID_FIELD", "Enter a valid employee email.");
      const mobile = string(input.mobile, "mobile number", 30, false); if (!PHONE.test(mobile)) throw new ApiError(400, "INVALID_FIELD", "Enter a valid mobile number.");
      const startDate = string(input.startDate, "start date", 10, false); if (startDate && !DATE.test(startDate)) throw new ApiError(400, "INVALID_FIELD", "Enter a valid start date.");
      const roleId = string(input.roleId, "role", 200);
      const [role] = await getDb().select({ id: accessRoles.id }).from(accessRoles).where(and(eq(accessRoles.id, roleId), eq(accessRoles.organizationId, context.organizationId), eq(accessRoles.archived, false))).limit(1);
      if (!role) throw new ApiError(400, "INVALID_FIELD", "Select a valid role.");
      const pinValue = string(input.temporaryPin, "temporary PIN", 8, false);
      const pin = pinValue ? validateTemporaryPin(pinValue) : "";
      const firstName = string(input.firstName, "first name", 80); const lastName = string(input.lastName, "last name", 80);
      const employeeCode = string(input.employeeCode, "employee identifier", 40);
      await database.prepare(`INSERT INTO team_members
        (id, organization_id, role_id, first_name, last_name, preferred_name, email, mobile, employee_code, job_title, department, employment_type, start_date, manager_member_id, primary_location_id, permitted_locations_json, status, remote_login, require_mfa, pin_enabled, notes, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, context.organizationId, roleId, firstName, lastName, string(input.preferredName, "preferred name", 80, false), email, mobile, employeeCode, string(input.jobTitle, "job title", 100, false), string(input.department, "department", 100, false), string(input.employmentType, "employment type", 60, false) || "employee", startDate || null, string(input.managerMemberId, "manager", 200, false) || null, string(input.primaryLocationId, "primary location", 200, false) || null, JSON.stringify(jsonArray(input.permittedLocations)), remoteLogin ? 1 : 0, boolean(input.requireMfa) ? 1 : 0, pin ? 1 : 0, string(input.notes, "notes", 1000, false), context.userId, now, now).run();
      if (pin) {
        const credential = await hashPin(pin);
        await database.prepare(`INSERT INTO employee_pin_credentials
          (member_id, organization_id, salt_hex, hash_hex, iterations, failed_attempts, expires_at, force_change, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 0, ?, 1, ?, ?)`)
          .bind(id, context.organizationId, credential.saltHex, credential.hashHex, credential.iterations, now + 86_400_000, now, now).run();
      }
      resourceType = "team_member"; resourceId = id; details = { action, remoteLogin, pinEnabled: Boolean(pin), invitationDelivery: "gated", billingPayer: "organization_owner" };
    } else if (action === "update_employee") {
      const memberId = string(input.memberId, "employee", 200);
      const status = string(input.status, "status", 40);
      if (!["draft", "active", "suspended", "archived"].includes(status)) throw new ApiError(400, "INVALID_FIELD", "Select a valid employee status.");
      const [member] = await getDb().select({ userId: teamMembers.userId }).from(teamMembers).where(and(eq(teamMembers.id, memberId), eq(teamMembers.organizationId, context.organizationId))).limit(1);
      if (!member) throw new ApiError(404, "NOT_FOUND", "Employee profile not found.");
      if (member.userId === context.userId && status !== "active") throw new ApiError(409, "LAST_OWNER_PROTECTED", "The active account owner cannot suspend or archive their own profile.");
      const roleId = string(input.roleId, "role", 200, false);
      await database.prepare("UPDATE team_members SET role_id = COALESCE(?, role_id), status = ?, updated_at = ? WHERE id = ? AND organization_id = ?").bind(roleId || null, status, now, memberId, context.organizationId).run();
      resourceType = "team_member"; resourceId = memberId; details = { action, status };
    } else if (action === "save_role") {
      const roleId = string(input.roleId, "role", 200, false) || crypto.randomUUID();
      const permissions = jsonArray(input.permissions).filter((permission) => allPermissions.includes(permission as never));
      const [existing] = await getDb().select({ systemKey: accessRoles.systemKey }).from(accessRoles).where(and(eq(accessRoles.id, roleId), eq(accessRoles.organizationId, context.organizationId))).limit(1);
      if (existing?.systemKey === "account_owner") throw new ApiError(409, "OWNER_ROLE_PROTECTED", "The Account Owner role cannot be changed.");
      await database.prepare(`INSERT INTO access_roles
        (id, organization_id, name, description, color, system_key, permissions_json, location_scope_json, archived, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 0, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, color = excluded.color, permissions_json = excluded.permissions_json, location_scope_json = excluded.location_scope_json, updated_at = excluded.updated_at`)
        .bind(roleId, context.organizationId, string(input.name, "role name", 100), string(input.description, "role description", 500, false), string(input.color, "role colour", 7), JSON.stringify(permissions), JSON.stringify(jsonArray(input.locationScope)), context.userId, now, now).run();
      resourceType = "access_role"; resourceId = roleId; details = { action, permissionCount: permissions.length };
    } else if (action === "reset_pin") {
      const memberId = string(input.memberId, "employee", 200); const pin = validateTemporaryPin(input.temporaryPin);
      const [member] = await getDb().select({ id: teamMembers.id }).from(teamMembers).where(and(eq(teamMembers.id, memberId), eq(teamMembers.organizationId, context.organizationId))).limit(1);
      if (!member) throw new ApiError(404, "NOT_FOUND", "Employee profile not found.");
      const credential = await hashPin(pin);
      await database.batch([
        database.prepare(`INSERT INTO employee_pin_credentials
          (member_id, organization_id, salt_hex, hash_hex, iterations, failed_attempts, locked_until, expires_at, force_change, revoked_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 0, NULL, ?, 1, NULL, ?, ?)
          ON CONFLICT(member_id) DO UPDATE SET salt_hex = excluded.salt_hex, hash_hex = excluded.hash_hex, iterations = excluded.iterations, failed_attempts = 0, locked_until = NULL, expires_at = excluded.expires_at, force_change = 1, revoked_at = NULL, updated_at = excluded.updated_at`)
          .bind(memberId, context.organizationId, credential.saltHex, credential.hashHex, credential.iterations, now + 86_400_000, now, now),
        database.prepare("UPDATE team_members SET pin_enabled = 1, updated_at = ? WHERE id = ? AND organization_id = ?").bind(now, memberId, context.organizationId),
      ]);
      resourceType = "pin_credential"; resourceId = memberId; details = { action, expiresInHours: 24 };
    } else {
      throw new ApiError(400, "UNKNOWN_ACTION", "Select a supported governance action.");
    }

    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: `governance.${action}`, resourceType, resourceId, details });
    return jsonResponse({ ok: true, governance: await responseBody(context) }, { status: action.startsWith("create_") ? 201 : 200 });
  });
}
