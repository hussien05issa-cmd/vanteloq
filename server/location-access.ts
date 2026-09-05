import { and, asc, count, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { accessRoles, integrationConnections, integrationLocationMappings, organizationLocations, teamMembers } from "../db/schema";
import { ApiError } from "./api";
import type { AccessContext } from "./authorization";
import { hasUnrestrictedLocationRole, parsePermittedLocationIds } from "../domain/location-scope";
import { resolveAuthorizedLocationScope } from "../domain/location-scope";
import { scopeExternalRef } from "../domain/integration-source";

export async function accessibleLocations(context: AccessContext) {
  const [member] = await getDb()
    .select({ permittedLocationsJson: teamMembers.permittedLocationsJson, roleId: teamMembers.roleId, systemKey: accessRoles.systemKey, roleLocationScopeJson: accessRoles.locationScopeJson })
    .from(teamMembers)
    .leftJoin(accessRoles, and(eq(teamMembers.roleId, accessRoles.id), eq(teamMembers.organizationId, accessRoles.organizationId)))
    .where(and(eq(teamMembers.organizationId, context.organizationId), eq(teamMembers.userId, context.userId)))
    .limit(1);
  const unrestricted = hasUnrestrictedLocationRole(context.role, member);
  const queryLocations = () => getDb()
    .select()
    .from(organizationLocations)
    .where(and(
      eq(organizationLocations.organizationId, context.organizationId),
      eq(organizationLocations.status, "active"),
    ))
    .orderBy(asc(organizationLocations.name));
  let locations = await queryLocations();
  if (!locations.length && unrestricted) {
    const now = new Date();
    await getDb().insert(organizationLocations).values({
      id: `${context.organizationId}:location:primary`,
      organizationId: context.organizationId,
      name: "Primary location",
      status: "active",
      countryCode: context.organization.country,
      addressLine1: context.organization.address,
      addressLine2: "",
      addressLine3: "",
      locality: context.organization.city,
      district: "",
      administrativeArea: context.organization.province,
      postalCode: context.organization.postalCode,
      timezone: context.organization.timezone,
      currency: context.organization.currency,
      locale: context.organization.country === "US" ? "en-US" : "en-CA",
      taxJurisdiction: "",
      validationStatus: "entered",
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();
    locations = await queryLocations();
  }
  if (context.role === "owner") return locations;
  const rolePermitted = new Set(parsePermittedLocationIds(member?.roleLocationScopeJson));
  if (unrestricted) return rolePermitted.size ? locations.filter((location) => rolePermitted.has(location.id)) : locations;
  const permitted = new Set(parsePermittedLocationIds(member?.permittedLocationsJson));
  return locations.filter((location) => permitted.has(location.id) && (!rolePermitted.size || rolePermitted.has(location.id)));
}

export async function requireAccessibleLocation(context: AccessContext, locationId: string) {
  const locations = await accessibleLocations(context);
  const location = locations.find((candidate) => candidate.id === locationId);
  if (!location) throw new ApiError(403, "LOCATION_ACCESS_DENIED", "This location is not available to your account.");
  return location;
}

export async function authorizedLocationScope(context: AccessContext, requestedLocationId: string | null) {
  const locations = await accessibleLocations(context);
  const [total] = await getDb().select({ value: count() }).from(organizationLocations).where(and(
    eq(organizationLocations.organizationId, context.organizationId),
    eq(organizationLocations.status, "active"),
  ));
  const organizationWide = context.role === "owner"
    || ((total?.value ?? 0) > 0 && locations.length === total.value);
  let resolved: ReturnType<typeof resolveAuthorizedLocationScope>;
  try {
    resolved = resolveAuthorizedLocationScope({
      organizationWide,
      accessibleLocationIds: locations.map((location) => location.id),
      requestedLocationId,
    });
  } catch {
    throw new ApiError(403, "LOCATION_ACCESS_DENIED", "This location is not available to your account.");
  }
  return {
    ...resolved,
    locations,
    organizationWide,
    selectedLocation: resolved.selectedLocationId
      ? locations.find((location) => location.id === resolved.selectedLocationId) ?? null
      : null,
  };
}

export async function requireOrganizationWideLocationAccess(context: AccessContext) {
  const access = await authorizedLocationScope(context, null);
  if (!access.organizationWide) {
    throw new ApiError(403, "ORGANIZATION_SCOPE_REQUIRED", "This organization-wide record is unavailable to a location-limited account.");
  }
  return access;
}

export async function authorizedLocationDataScope(context: AccessContext, requestedLocationId: string | null) {
  const access = await authorizedLocationScope(context, requestedLocationId);
  if (access.locationIds === null) return {
    ...access,
    locationRefs: null,
    externalLocationRefs: null,
    providerLocations: null,
    providerByRef: new Map<string, string>(),
  };
  const scopedLocations = access.locations.filter((location) => access.locationIds?.includes(location.id));
  const mappings = access.locationIds.length
    ? await getDb().select({
      provider: integrationLocationMappings.provider,
      connectionId: integrationLocationMappings.connectionId,
      sourceNamespace: integrationConnections.sourceNamespace,
      externalLocationRef: integrationLocationMappings.externalLocationRef,
      }).from(integrationLocationMappings).innerJoin(
        integrationConnections,
        and(
          eq(integrationConnections.id, integrationLocationMappings.connectionId),
          eq(integrationConnections.organizationId, integrationLocationMappings.organizationId),
        ),
      ).where(and(
        eq(integrationLocationMappings.organizationId, context.organizationId),
        inArray(integrationLocationMappings.localLocationId, access.locationIds),
        eq(integrationLocationMappings.status, "mapped"),
        eq(integrationConnections.status, "connected"),
        eq(integrationConnections.dataPromotionStatus, "approved"),
      ))
    : [];
  const refs = new Set(scopedLocations.map((location) => location.id));
  const providerByRef = new Map<string, string>();
  const providerLocations: Array<{ provider: string; connectionId: string; externalLocationRef: string }> = [];
  for (const mapping of mappings) {
    const externalRef = scopeExternalRef(mapping.sourceNamespace, mapping.externalLocationRef)!;
    const metricRef = `${mapping.provider}:${externalRef}`;
    refs.add(metricRef);
    providerByRef.set(metricRef, mapping.provider);
    providerLocations.push({
      provider: mapping.provider,
      connectionId: mapping.connectionId,
      externalLocationRef: externalRef,
    });
  }
  return {
    ...access,
    locationRefs: [...refs],
    externalLocationRefs: [...new Set(providerLocations.map((mapping) => mapping.externalLocationRef))],
    providerLocations,
    providerByRef,
  };
}
