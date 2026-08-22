import { and, asc, eq, inArray } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { accountPreferences, accessRoles, organizationLocations, organizationProfiles, teamMembers, users } from "../../../../db/schema";
import { recordAudit } from "../../../../server/audit";
import { requireAccess } from "../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../server/api";
import { allPermissions, effectivePermissions, permissionCatalogDto, requirePermission, roleTemplates, type PermissionKey } from "../../../../server/permissions";
import { hashPin, validateTemporaryPin } from "../../../../server/pin";
import { canAddLocation, canAddUser, requireFeature } from "../../../../server/entitlements/engine";

const governanceUsers = ["owner", "admin", "manager", "employee", "read_only"] as const;
const governanceReadPermissions = [
  "organization.settings",
  "locations.manage",
  "team.directory",
  "team.contacts",
  "team.create",
  "team.edit",
  "team.roles",
  "team.pin_reset",
] as const satisfies readonly PermissionKey[];
const governanceActionPermissions = {
  update_profile: "organization.settings",
  update_organization: "organization.settings",
  create_location: "locations.manage",
  create_employee: "team.create",
  update_employee: "team.edit",
  save_role: "team.roles",
  reset_pin: "team.pin_reset",
} as const satisfies Record<string, PermissionKey>;
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
function storedPermissions(value: string): PermissionKey[] {
  try {
    return jsonArray(JSON.parse(value)).filter((permission): permission is PermissionKey => allPermissions.includes(permission as PermissionKey));
  } catch {
    return [];
  }
}

async function requireDelegablePermissions(context: Awaited<ReturnType<typeof requireAccess>>, permissions: readonly PermissionKey[]) {
  const actorPermissions = await effectivePermissions(context);
  if (permissions.some((permission) => !actorPermissions.includes(permission))) {
    throw new ApiError(403, "INSUFFICIENT_PERMISSION", "You cannot grant permissions that are outside your own access.");
  }
}

async function governancePermissions(context: Awaited<ReturnType<typeof requireAccess>>) {
  const permissions = await effectivePermissions(context);
  if (!governanceReadPermissions.some((permission) => permissions.includes(permission))) {
    throw new ApiError(403, "INSUFFICIENT_PERMISSION", "You do not have permission to perform this action.");
  }
  return permissions;
}

type GovernanceContext = Awaited<ReturnType<typeof requireAccess>>;

async function validateEmployeeRelationships(
  organizationId: string,
  managerMemberId: string,
  primaryLocationId: string,
  permittedLocations: string[],
) {
  if (managerMemberId) {
    const [manager] = await getDb().select({ id: teamMembers.id, status: teamMembers.status }).from(teamMembers).where(and(
      eq(teamMembers.id, managerMemberId),
      eq(teamMembers.organizationId, organizationId),
    )).limit(1);
    if (!manager || manager.status !== "active") throw new ApiError(400, "INVALID_FIELD", "Select an active manager from this organization.");
  }

  const locationIds = [...new Set([primaryLocationId, ...permittedLocations].filter(Boolean))];
  if (locationIds.length) {
    const locations = await getDb().select({ id: organizationLocations.id }).from(organizationLocations).where(and(
      eq(organizationLocations.organizationId, organizationId),
      eq(organizationLocations.status, "active"),
      inArray(organizationLocations.id, locationIds),
    ));
    if (locations.length !== locationIds.length) throw new ApiError(400, "INVALID_FIELD", "Select active locations from this organization.");
  }
  return {
    managerMemberId: managerMemberId || null,
    primaryLocationId: primaryLocationId || null,
    permittedLocations: locationIds,
  };
}

async function validateRoleDelegation(context: GovernanceContext, permissions: string[], locationScope: string[]) {
  const allowed = new Set(await effectivePermissions(context));
  const requested = permissions.filter((permission): permission is PermissionKey => allPermissions.includes(permission as PermissionKey));
  if (requested.length !== permissions.length || requested.some((permission) => !allowed.has(permission))) {
    throw new ApiError(403, "ROLE_DELEGATION_EXCEEDED", "A role cannot grant permissions you do not hold.");
  }
  if (context.role !== "owner" && requested.includes("organization.ownership")) {
    throw new ApiError(403, "OWNERSHIP_PERMISSION_PROTECTED", "Only the account owner can delegate ownership controls.");
  }
  const relationships = await validateEmployeeRelationships(context.organizationId, "", "", locationScope);
  return { permissions: requested, locationScope: relationships.permittedLocations };
}

async function assignableRole(context: GovernanceContext, roleId: string) {
  const [role] = await getDb().select({ id: accessRoles.id, systemKey: accessRoles.systemKey, permissionsJson: accessRoles.permissionsJson }).from(accessRoles).where(and(
    eq(accessRoles.id, roleId),
    eq(accessRoles.organizationId, context.organizationId),
    eq(accessRoles.archived, false),
  )).limit(1);
  if (!role) throw new ApiError(400, "INVALID_FIELD", "Select a valid role.");
  if (role.systemKey === "account_owner") throw new ApiError(409, "OWNER_ROLE_PROTECTED", "Account ownership must use the dedicated ownership-transfer workflow.");
  const delegated = jsonArray(JSON.parse(role.permissionsJson));
  await validateRoleDelegation(context, delegated, []);
  return { ...role, permissions: delegated };
}

function coarseRoleFor(role: { systemKey: string | null; permissions: string[] }) {
  if (role.systemKey === "organization_administrator") return "admin" as const;
  if (["external_advisor", "read_only_reviewer"].includes(role.systemKey ?? "")) return "read_only" as const;
  if (["employee", "team_lead"].includes(role.systemKey ?? "")) return "employee" as const;
  if (role.permissions.some((permission) => ["organization.settings", "organization.billing", "team.roles", "team.create", "team.edit", "locations.manage", "integrations.manage"].includes(permission))) return "admin" as const;
  if (role.permissions.some((permission) => !permission.includes(".view") && !permission.startsWith("metrics.") && !permission.startsWith("reports."))) return "manager" as const;
  return "read_only" as const;
}

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
  const statements = [
    database.prepare(`INSERT OR IGNORE INTO organization_profiles
      (organization_id, display_name, organization_type, business_structure, locale, language, brand_color, logo_alt_text, logo_version, created_at, updated_at)
      VALUES (?, ?, 'business', '', ?, 'en', '#2368c4', 'Organization logo', 0, ?, ?)`)
      .bind(organizationId, businessName, country === "US" ? "en-US" : "en-CA", now, now),
    database.prepare(`INSERT OR IGNORE INTO organization_locations
      (id, organization_id, name, status, country_code, address_line_1, address_line_2, address_line_3, locality, district, administrative_area, postal_code, timezone, currency, locale, tax_jurisdiction, validation_status, created_at, updated_at)
      VALUES (?, ?, 'Primary location', 'active', ?, ?, '', '', ?, '', ?, ?, ?, ?, ?, '', 'entered', ?, ?)`)
      .bind(`${organizationId}:location:primary`, organizationId, country, address, city, province, postalCode, timezone, currency, country === "US" ? "en-US" : "en-CA", now, now),
    ...roleStatements,
  ];
  statements.push(database.prepare(`INSERT OR IGNORE INTO team_members
      (id, organization_id, user_id, role_id, first_name, last_name, preferred_name, email, mobile, employee_code, job_title, department, employment_type, start_date, permitted_locations_json, status, remote_login, require_mfa, pin_enabled, notes, created_by_user_id, created_at, updated_at)
      SELECT ?, ?, owner.id, ?, ?, ?, ?, owner.email, '', 'OWNER', 'Account Owner', 'Executive', 'owner', date('now'), ?, 'active', 1, 1, 0, '', ?, ?, ?
      FROM users owner
      INNER JOIN memberships owner_membership ON owner_membership.user_id = owner.id
      WHERE owner_membership.organization_id = ? AND owner_membership.role = 'owner'
        AND owner_membership.status = 'active' AND owner.status = 'active'
      ORDER BY owner_membership.created_at ASC LIMIT 1`)
      .bind(`${organizationId}:member:owner`, organizationId, `${organizationId}:role:account_owner`, firstName, lastName, ownerName, JSON.stringify([`${organizationId}:location:primary`]), userId, now, now, organizationId));
  await database.batch(statements);
}

async function responseBody(context: Awaited<ReturnType<typeof requireAccess>>, grantedPermissions?: readonly PermissionKey[]) {
  const permissions = grantedPermissions ?? await effectivePermissions(context);
  await bootstrap(context.organizationId, context.userId, context.organization.ownerName, context.organization.businessName, context.organization.country, context.organization.province, context.organization.city, context.organization.address, context.organization.postalCode, context.organization.timezone, context.organization.currency);
  const [profile] = await getDb().select().from(organizationProfiles).where(eq(organizationProfiles.organizationId, context.organizationId)).limit(1);
  const [preferences] = await getDb().select().from(accountPreferences).where(eq(accountPreferences.userId, context.userId)).limit(1);
  const [account] = await getDb().select({ displayName: users.displayName, email: users.email }).from(users).where(eq(users.id, context.userId)).limit(1);
  const locations = await getDb().select().from(organizationLocations).where(eq(organizationLocations.organizationId, context.organizationId)).orderBy(asc(organizationLocations.name));
  const roles = await getDb().select().from(accessRoles).where(and(eq(accessRoles.organizationId, context.organizationId), eq(accessRoles.archived, false))).orderBy(asc(accessRoles.name));
  const members = await getDb().select().from(teamMembers).where(eq(teamMembers.organizationId, context.organizationId)).orderBy(asc(teamMembers.firstName));
  const authenticationProvider = context.identity.provider === "supabase"
    ? "Supabase authentication"
    : "Sites authentication";
  const canViewOrganization = permissions.includes("organization.settings");
  const canViewLocations = canViewOrganization || permissions.includes("locations.manage") || permissions.includes("team.create") || permissions.includes("team.edit") || permissions.includes("team.roles");
  const canViewDirectory = permissions.includes("team.directory") || permissions.includes("team.contacts") || permissions.includes("team.create") || permissions.includes("team.edit") || permissions.includes("team.roles") || permissions.includes("team.pin_reset");
  const canViewContacts = permissions.includes("team.contacts");
  const canViewRoleDefinitions = permissions.includes("team.roles");
  return {
    account: { ...account, emailVerified: context.identity.emailVerified, authenticationProvider },
    organization: canViewOrganization ? { ...context.organization, displayName: profile?.displayName ?? context.organization.businessName, organizationType: profile?.organizationType ?? "business", businessStructure: profile?.businessStructure ?? "", locale: profile?.locale ?? "en-CA", language: profile?.language ?? "en", brandColor: profile?.brandColor ?? "#2368c4", logoAvailable: Boolean(profile?.logoObjectKey), logoVersion: profile?.logoVersion ?? 0 } : null,
    preferences: preferences ?? { emailNotifications: true, rememberedProfile: true, hiddenNavigationJson: "[]", preferredLocationId: null },
    locations: canViewLocations ? locations.map((location) => ({
      id: location.id,
      name: location.name,
      status: location.status,
      countryCode: location.countryCode,
      addressLine1: location.addressLine1,
      locality: location.locality,
      administrativeArea: location.administrativeArea,
      postalCode: location.postalCode,
      timezone: location.timezone,
      currency: location.currency,
      validationStatus: location.validationStatus,
    })) : [],
    roles: canViewDirectory ? roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      color: role.color,
      systemKey: role.systemKey,
      permissions: canViewRoleDefinitions ? storedPermissions(role.permissionsJson) : [],
      locationScopeJson: canViewRoleDefinitions ? role.locationScopeJson : "[]",
    })) : [],
    members: canViewDirectory ? members.map((member) => ({
      id: member.id,
      userId: member.userId,
      roleId: member.roleId,
      firstName: member.firstName,
      lastName: member.lastName,
      preferredName: member.preferredName,
      email: canViewContacts ? member.email : "",
      mobile: canViewContacts ? member.mobile : "",
      employeeCode: member.employeeCode,
      jobTitle: member.jobTitle,
      department: member.department,
      employmentType: member.employmentType,
      status: member.status,
      remoteLogin: member.remoteLogin,
      requireMfa: member.requireMfa,
      pinEnabled: member.pinEnabled,
      primaryLocationId: member.primaryLocationId,
      permittedLocations: jsonArray(JSON.parse(member.permittedLocationsJson)),
      lastLoginAt: member.lastLoginAt,
    })) : [],
    permissionCatalog: canViewRoleDefinitions ? permissionCatalogDto() : [],
    security: {
      password: `Managed by ${authenticationProvider}`,
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
    const context = await requireAccess(request, governanceUsers, "permissions.standard");
    const permissions = await governancePermissions(context);
    await enforceRateLimit("governance:read", context.userId, 90, 60);
    return jsonResponse({ governance: await responseBody(context, permissions) });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, governanceUsers, "permissions.standard");
    await enforceRateLimit("governance:write", context.userId, 40, 3_600);
    const input = await readJsonObject(request, 128_000);
    const action = string(input.action, "action", 60);
    if (action === "save_role") await requireFeature(context, "permissions.advanced");
    const permission = governanceActionPermissions[action as keyof typeof governanceActionPermissions];
    if (!permission) throw new ApiError(400, "UNKNOWN_ACTION", "Select a supported governance action.");
    await requirePermission(context, permission);
    if (action === "update_employee" && typeof input.roleId === "string" && input.roleId.trim()) {
      await requirePermission(context, "team.roles");
    }
    await bootstrap(context.organizationId, context.userId, context.organization.ownerName, context.organization.businessName, context.organization.country, context.organization.province, context.organization.city, context.organization.address, context.organization.postalCode, context.organization.timezone, context.organization.currency);
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
      const locationInsert = await database.prepare(`INSERT INTO organization_locations
        (id, organization_id, name, status, country_code, address_line_1, address_line_2, address_line_3, locality, district, administrative_area, postal_code, timezone, currency, locale, tax_jurisdiction, validation_status, created_at, updated_at)
        SELECT ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'entered', ?, ?
        WHERE (SELECT COUNT(*) FROM organization_locations WHERE organization_id = ? AND status = 'active') < ?`)
        .bind(id, context.organizationId, string(input.name, "location name", 120), countryCode, string(input.addressLine1, "address", 180), string(input.addressLine2, "address line 2", 180, false), string(input.addressLine3, "address line 3", 180, false), string(input.locality, "locality", 100), string(input.district, "district", 100, false), string(input.administrativeArea, "administrative area", 100), string(input.postalCode, "postal code", 20, false), string(input.timezone, "timezone", 80), currency, string(input.locale, "locale", 20), string(input.taxJurisdiction, "tax jurisdiction", 100, false), now, now, context.organizationId, capacity.limit).run();
      if (Number(locationInsert.meta.changes ?? 0) !== 1) {
        throw new ApiError(409, "LOCATION_LIMIT_REACHED", `The owner plan includes ${capacity.limit} locations. Manage the organization plan before adding another location.`);
      }
      resourceType = "location"; resourceId = id;
    } else if (action === "create_employee") {
      const id = crypto.randomUUID();
      const remoteLogin = boolean(input.remoteLogin);
      const remoteCapacity = remoteLogin ? await canAddUser(context) : null;
      if (remoteCapacity && !remoteCapacity.allowed) {
        throw new ApiError(409, "TEAM_SEAT_LIMIT_REACHED", remoteCapacity.reason === "subscription_required"
          ? "An active owner subscription is required before remote employee access can be added."
          : `The owner plan includes ${remoteCapacity.limit} remote seats. Manage the organization plan before adding another remote login.`);
      }
      const email = string(input.email, "employee email", 254).toLowerCase(); if (!EMAIL.test(email)) throw new ApiError(400, "INVALID_FIELD", "Enter a valid employee email.");
      const mobile = string(input.mobile, "mobile number", 30, false); if (!PHONE.test(mobile)) throw new ApiError(400, "INVALID_FIELD", "Enter a valid mobile number.");
      const startDate = string(input.startDate, "start date", 10, false); if (startDate && !DATE.test(startDate)) throw new ApiError(400, "INVALID_FIELD", "Enter a valid start date.");
      const roleId = string(input.roleId, "role", 200);
      const [role] = await getDb().select({ id: accessRoles.id, systemKey: accessRoles.systemKey, permissionsJson: accessRoles.permissionsJson }).from(accessRoles).where(and(
        eq(accessRoles.id, roleId),
        eq(accessRoles.organizationId, context.organizationId),
        eq(accessRoles.archived, false),
      )).limit(1);
      if (!role) throw new ApiError(400, "INVALID_FIELD", "Select a valid role.");
      if (role.systemKey === "account_owner") throw new ApiError(409, "OWNER_ROLE_PROTECTED", "The Account Owner role cannot be assigned here.");
      if (role.systemKey !== "employee") {
        await requirePermission(context, "team.roles");
        await requireDelegablePermissions(context, storedPermissions(role.permissionsJson));
      }
      const pinValue = string(input.temporaryPin, "temporary PIN", 8, false);
      const pin = pinValue ? validateTemporaryPin(pinValue) : "";
      const firstName = string(input.firstName, "first name", 80); const lastName = string(input.lastName, "last name", 80);
      const employeeCode = string(input.employeeCode, "employee identifier", 40);
      const relationships = await validateEmployeeRelationships(
        context.organizationId,
        string(input.managerMemberId, "manager", 200, false),
        string(input.primaryLocationId, "primary location", 200, false),
        jsonArray(input.permittedLocations),
      );
      const employeeInsert = await database.prepare(`INSERT INTO team_members
        (id, organization_id, role_id, first_name, last_name, preferred_name, email, mobile, employee_code, job_title, department, employment_type, start_date, manager_member_id, primary_location_id, permitted_locations_json, status, remote_login, require_mfa, pin_enabled, notes, created_by_user_id, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?
        WHERE ? = 0 OR (SELECT COUNT(*) FROM team_members
          WHERE organization_id = ? AND remote_login = 1
            AND status IN ('draft', 'invited', 'pending_verification', 'active')) < ?`)
        .bind(id, context.organizationId, roleId, firstName, lastName, string(input.preferredName, "preferred name", 80, false), email, mobile, employeeCode, string(input.jobTitle, "job title", 100, false), string(input.department, "department", 100, false), string(input.employmentType, "employment type", 60, false) || "employee", startDate || null, relationships.managerMemberId, relationships.primaryLocationId, JSON.stringify(relationships.permittedLocations), remoteLogin ? 1 : 0, boolean(input.requireMfa) ? 1 : 0, pin ? 1 : 0, string(input.notes, "notes", 1000, false), context.userId, now, now, remoteLogin ? 1 : 0, context.organizationId, remoteCapacity?.limit ?? 0).run();
      if (Number(employeeInsert.meta.changes ?? 0) !== 1) {
        throw new ApiError(409, "TEAM_SEAT_LIMIT_REACHED", `The owner plan includes ${remoteCapacity?.limit ?? 0} remote seats. Manage the organization plan before adding another remote login.`);
      }
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
      const [member] = await getDb().select({ userId: teamMembers.userId, roleId: teamMembers.roleId, systemKey: accessRoles.systemKey })
        .from(teamMembers)
        .leftJoin(accessRoles, and(eq(teamMembers.roleId, accessRoles.id), eq(teamMembers.organizationId, accessRoles.organizationId)))
        .where(and(eq(teamMembers.id, memberId), eq(teamMembers.organizationId, context.organizationId))).limit(1);
      if (!member) throw new ApiError(404, "NOT_FOUND", "Employee profile not found.");
      if (member.userId === context.userId && status !== "active") throw new ApiError(409, "LAST_OWNER_PROTECTED", "The active account owner cannot suspend or archive their own profile.");
      const roleId = string(input.roleId, "role", 200, false);
      if (member.systemKey === "account_owner" && (status !== "active" || (roleId && roleId !== member.roleId))) {
        throw new ApiError(409, "OWNER_ROLE_PROTECTED", "The Account Owner profile and role cannot be changed here.");
      }
      if (roleId) {
        await requirePermission(context, "team.roles");
        const [requestedRole] = await getDb().select({ systemKey: accessRoles.systemKey }).from(accessRoles).where(and(
          eq(accessRoles.id, roleId),
          eq(accessRoles.organizationId, context.organizationId),
          eq(accessRoles.archived, false),
        )).limit(1);
        if (requestedRole?.systemKey === "account_owner") {
          throw new ApiError(409, "OWNER_ROLE_PROTECTED", "The Account Owner role cannot be assigned here.");
        }
      }
      if (member.userId === context.userId && roleId && roleId !== member.roleId) {
        throw new ApiError(409, "SELF_ROLE_CHANGE_FORBIDDEN", "You cannot change your own access role.");
      }
      const nextRole = roleId ? await assignableRole(context, roleId) : null;
      const statements = [database.prepare("UPDATE team_members SET role_id = COALESCE(?, role_id), status = ?, updated_at = ? WHERE id = ? AND organization_id = ?").bind(roleId || null, status, now, memberId, context.organizationId)];
      if (member.userId) statements.push(database.prepare("UPDATE memberships SET role = COALESCE(?, role), status = ?, updated_at = ? WHERE user_id = ? AND organization_id = ?").bind(nextRole ? coarseRoleFor(nextRole) : null, status === "active" ? "active" : "suspended", now, member.userId, context.organizationId));
      await database.batch(statements);
      resourceType = "team_member"; resourceId = memberId; details = { action, status };
    } else if (action === "save_role") {
      const suppliedRoleId = string(input.roleId, "role", 200, false);
      const roleId = suppliedRoleId || crypto.randomUUID();
      const delegated = await validateRoleDelegation(context, jsonArray(input.permissions), jsonArray(input.locationScope));
      const values = [string(input.name, "role name", 100), string(input.description, "role description", 500, false), string(input.color, "role colour", 7), JSON.stringify(delegated.permissions), JSON.stringify(delegated.locationScope), now];
      if (suppliedRoleId) {
        const [existing] = await getDb().select({ systemKey: accessRoles.systemKey }).from(accessRoles).where(and(eq(accessRoles.id, roleId), eq(accessRoles.organizationId, context.organizationId))).limit(1);
        if (!existing) throw new ApiError(404, "ROLE_NOT_FOUND", "Role not found in this organization.");
        if (existing.systemKey === "account_owner") throw new ApiError(409, "OWNER_ROLE_PROTECTED", "The Account Owner role cannot be changed.");
        if (existing.systemKey) throw new ApiError(409, "SYSTEM_ROLE_PROTECTED", "Built-in roles cannot be changed. Create a custom role instead.");
        await database.prepare("UPDATE access_roles SET name = ?, description = ?, color = ?, permissions_json = ?, location_scope_json = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND system_key IS NULL").bind(...values, roleId, context.organizationId).run();
      } else {
        await database.prepare(`INSERT INTO access_roles
          (id, organization_id, name, description, color, system_key, permissions_json, location_scope_json, archived, created_by_user_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 0, ?, ?, ?)`)
          .bind(roleId, context.organizationId, values[0], values[1], values[2], values[3], values[4], context.userId, now, now).run();
      }
      resourceType = "access_role"; resourceId = roleId; details = { action, permissionCount: delegated.permissions.length };
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
