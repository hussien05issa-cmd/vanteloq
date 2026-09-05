export type ProviderLocationMapping = {
  organizationLocationId: string;
  provider: string;
  connectionId: string;
  providerLocationRef: string;
};

export type ProviderLocationRef = Pick<ProviderLocationMapping, "provider" | "connectionId" | "providerLocationRef">;

export type AuthorizedLocationScope = {
  /** null means the caller may read every location in the organization. */
  locationIds: string[] | null;
  selectedLocationId: string | null;
};

export function hasUnrestrictedLocationRole(
  role: string,
  profile: { systemKey: string | null; roleId?: string | null } | null | undefined,
): boolean {
  if (role === "owner") return true;
  // Preserve legacy administrators without a team profile. A custom role,
  // even when represented as admin for compatibility, keeps explicit scope.
  return role === "admin" && (!profile || profile.roleId === null || profile.systemKey === "organization_administrator");
}

export function resolveAuthorizedLocationScope(input: {
  organizationWide: boolean;
  accessibleLocationIds: readonly string[];
  requestedLocationId: string | null;
}): AuthorizedLocationScope {
  const accessibleLocationIds = [...new Set(input.accessibleLocationIds)];
  if (input.requestedLocationId) {
    if (!accessibleLocationIds.includes(input.requestedLocationId)) {
      throw new Error("The requested location is not accessible to this account.");
    }
    return {
      locationIds: [input.requestedLocationId],
      selectedLocationId: input.requestedLocationId,
    };
  }
  return {
    locationIds: input.organizationWide ? null : accessibleLocationIds,
    selectedLocationId: null,
  };
}

export function parsePermittedLocationIds(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((item): item is string => typeof item === "string" && item.length > 0))];
  } catch {
    return [];
  }
}

export function resolveProviderLocationRefs(
  mappings: readonly ProviderLocationMapping[],
  organizationLocationId: string | null,
): ProviderLocationRef[] {
  if (!organizationLocationId) return [];
  const seen = new Set<string>();
  return mappings.flatMap((mapping) => {
    if (mapping.organizationLocationId !== organizationLocationId) return [];
    const key = `${mapping.provider}\u0000${mapping.connectionId}\u0000${mapping.providerLocationRef}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ provider: mapping.provider, connectionId: mapping.connectionId, providerLocationRef: mapping.providerLocationRef }];
  });
}

export function filterRowsForLocation<T extends { provider: string; connectionId: string; locationRef: string | null }>(
  rows: readonly T[],
  allowedRefs: readonly ProviderLocationRef[],
): T[] {
  const allowed = new Set(allowedRefs.map((item) => `${item.provider}\u0000${item.connectionId}\u0000${item.providerLocationRef}`));
  return rows.filter((row) => row.locationRef !== null && allowed.has(`${row.provider}\u0000${row.connectionId}\u0000${row.locationRef}`));
}
