export type ProviderLocationMapping = {
  organizationLocationId: string;
  provider: string;
  providerLocationRef: string;
};

export type ProviderLocationRef = Pick<ProviderLocationMapping, "provider" | "providerLocationRef">;

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
    const key = `${mapping.provider}\u0000${mapping.providerLocationRef}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ provider: mapping.provider, providerLocationRef: mapping.providerLocationRef }];
  });
}

export function filterRowsForLocation<T extends { provider: string; locationRef: string | null }>(
  rows: readonly T[],
  allowedRefs: readonly ProviderLocationRef[],
): T[] {
  const allowed = new Set(allowedRefs.map((item) => `${item.provider}\u0000${item.providerLocationRef}`));
  return rows.filter((row) => row.locationRef !== null && allowed.has(`${row.provider}\u0000${row.locationRef}`));
}
