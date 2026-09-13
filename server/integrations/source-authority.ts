import { and, eq, inArray } from "drizzle-orm";
import { getD1, getDb } from "../../db";
import {
  integrationConnections,
  integrationLocationMappings,
  integrationSourceAuthorities,
} from "../../db/schema";
import { selectAuthoritativeReportScopes, type ReportSourceCandidate } from "../../domain/provider-report-contracts";
import { scopeExternalRef } from "../../domain/integration-source";

export type CommerceChannel = "retail" | "ecommerce" | "marketplace" | "delivery";
export type CommerceFactFamily = "sales" | "payments" | "inventory" | "products" | "customers" | "suppliers";

export function defaultCommerceChannel(provider: string): CommerceChannel {
  if (["shopify", "woocommerce"].includes(provider)) return "ecommerce";
  if (["amazon"].includes(provider)) return "marketplace";
  if (["doordash", "uber-eats"].includes(provider)) return "delivery";
  return "retail";
}

export async function commerceSourceAuthority(input: {
  organizationId: string;
  localLocationIds: readonly string[];
  factFamily: CommerceFactFamily;
  salesLineFacts?: boolean;
}) {
  if (!input.localLocationIds.length) {
    return { status: "ready" as const, authoritativeConnectionIds: [] as string[], conflicts: [], selections: [], candidates: [] };
  }
  const [mappings, authorities] = await Promise.all([
    getDb().select({
      provider: integrationLocationMappings.provider,
      connectionId: integrationLocationMappings.connectionId,
      localLocationId: integrationLocationMappings.localLocationId,
      externalLocationRef: integrationLocationMappings.externalLocationRef,
      sourceNamespace: integrationConnections.sourceNamespace,
      accountName: integrationConnections.externalAccountName,
      lastSuccessfulSyncAt: integrationConnections.lastSuccessfulSyncAt,
      connectionStatus: integrationConnections.status,
      dataPromotionStatus: integrationConnections.dataPromotionStatus,
      syncLeaseOwner: integrationConnections.syncLeaseOwner,
      syncLeaseExpiresAt: integrationConnections.syncLeaseExpiresAt,
    }).from(integrationLocationMappings).innerJoin(integrationConnections, and(
      eq(integrationConnections.id, integrationLocationMappings.connectionId),
      eq(integrationConnections.organizationId, integrationLocationMappings.organizationId),
    )).where(and(
      eq(integrationLocationMappings.organizationId, input.organizationId),
      eq(integrationLocationMappings.status, "mapped"),
      inArray(integrationLocationMappings.localLocationId, [...input.localLocationIds]),
    )),
    getDb().select().from(integrationSourceAuthorities).where(and(
      eq(integrationSourceAuthorities.organizationId, input.organizationId),
      eq(integrationSourceAuthorities.factFamily, input.factFamily),
      inArray(integrationSourceAuthorities.localLocationId, [...input.localLocationIds]),
    )),
  ]);
  const connectionIds = [...new Set(mappings.map((mapping) => mapping.connectionId))];
  const connectionPlaceholders = connectionIds.map(() => "?").join(", ") || "NULL";
  const scopedFactSql: Record<CommerceFactFamily, string> = {
    sales: input.salesLineFacts
      ? `SELECT connection_id connectionId, provider || ':' || outlet_ref scopeRef FROM commerce_sale_lines WHERE organization_id = ? AND connection_id IN (${connectionPlaceholders}) GROUP BY provider, connection_id, outlet_ref`
      : `SELECT source_connection_id connectionId, location_ref scopeRef FROM daily_business_metrics WHERE organization_id = ? AND source_connection_id IN (${connectionPlaceholders}) GROUP BY source_connection_id, location_ref`,
    payments: `SELECT connection_id connectionId, outlet_ref scopeRef FROM commerce_payments WHERE organization_id = ? AND connection_id IN (${connectionPlaceholders}) AND paid_at IS NOT NULL AND amount_cents > 0 GROUP BY connection_id, outlet_ref`,
    inventory: `SELECT source_connection_id connectionId, location_ref scopeRef FROM inventory_balances WHERE organization_id = ? AND source_connection_id IN (${connectionPlaceholders}) GROUP BY source_connection_id, location_ref`,
    products: `SELECT connection_id connectionId, NULL scopeRef FROM commerce_products WHERE organization_id = ? AND connection_id IN (${connectionPlaceholders}) AND archived = 0 GROUP BY connection_id`,
    customers: `SELECT connection_id connectionId, NULL scopeRef FROM commerce_customers WHERE organization_id = ? AND connection_id IN (${connectionPlaceholders}) AND archived = 0 GROUP BY connection_id`,
    suppliers: `SELECT connection_id connectionId, NULL scopeRef FROM commerce_suppliers WHERE organization_id = ? AND connection_id IN (${connectionPlaceholders}) AND archived = 0 GROUP BY connection_id`,
  };
  const factRows = connectionIds.length
    ? (await getD1().prepare(scopedFactSql[input.factFamily]).bind(input.organizationId, ...connectionIds).all<{
        connectionId: string;
        scopeRef: string | null;
      }>()).results ?? []
    : [];
  const connectionFactIds = new Set(factRows.map((row) => row.connectionId));
  const scopedFactRefs = new Set(factRows.map((row) => `${row.connectionId}:${row.scopeRef ?? ""}`));
  const locationScopedFamily = input.factFamily === "sales" || input.factFamily === "payments" || input.factFamily === "inventory";
  const hasFacts = (connectionId: string, metricLocationRef: string, externalOutletRef: string) => locationScopedFamily
    ? scopedFactRefs.has(`${connectionId}:${input.factFamily === "payments" ? externalOutletRef : metricLocationRef}`)
    : connectionFactIds.has(connectionId);
  const authoritativeConnectionIds = new Set<string>();
  const conflicts: Array<{ localLocationId: string; channel: CommerceChannel; expectedVersion: number; candidates: ReportSourceCandidate[] }> = [];
  const selections: Array<{ localLocationId: string; channel: CommerceChannel; connectionId: string; provider: string; metricLocationRef: string | null; externalOutletRef: string | null; accountName: string | null; mode: string }> = [];
  const allCandidates: Array<ReportSourceCandidate & { localLocationId: string; channel: CommerceChannel }> = [];
  const needsData: Array<{ localLocationId: string; channel: CommerceChannel; candidates: ReportSourceCandidate[] }> = [];
  for (const localLocationId of input.localLocationIds) {
    const channels = new Set(
      mappings.filter((mapping) => mapping.localLocationId === localLocationId).map((mapping) => defaultCommerceChannel(mapping.provider)),
    );
    for (const channel of channels) {
      const candidates: ReportSourceCandidate[] = mappings
        .filter((mapping) => mapping.localLocationId === localLocationId && defaultCommerceChannel(mapping.provider) === channel)
        .flatMap((mapping) => {
          const externalOutletRef = scopeExternalRef(mapping.sourceNamespace, mapping.externalLocationRef);
          if (!externalOutletRef) return [];
          const metricLocationRef = `${mapping.provider}:${externalOutletRef}`;
          const candidateHasFacts = hasFacts(mapping.connectionId, metricLocationRef, externalOutletRef);
          const leaseActive = Boolean(mapping.syncLeaseOwner && mapping.syncLeaseExpiresAt && mapping.syncLeaseExpiresAt.getTime() > Date.now());
          const availability = mapping.connectionStatus !== "connected"
            ? "unavailable" as const
            : leaseActive
              ? "syncing" as const
              : mapping.dataPromotionStatus !== "approved"
                ? "staging" as const
                : !candidateHasFacts
                  ? "needs_data" as const
                  : "ready" as const;
          return [{
            provider: mapping.provider,
            connectionId: mapping.connectionId,
            locationId: localLocationId,
            lastSuccessfulSyncAt: mapping.lastSuccessfulSyncAt?.toISOString() ?? null,
            metricLocationRef,
            externalOutletRef,
            accountName: mapping.accountName,
            hasFacts: candidateHasFacts,
            availability,
          }];
        });
      allCandidates.push(...candidates.map((candidate) => ({ ...candidate, localLocationId, channel })));
      const authority = authorities.find((candidate) => candidate.localLocationId === localLocationId && candidate.channel === channel) ?? null;
      const preferred = authority?.connectionId ?? null;
      const expectedVersion = authority?.version ?? 0;
      const connectionCandidates = [...new Map(candidates.map((candidate) => [candidate.connectionId, candidate])).values()];
      const preferredScopes = preferred ? candidates.filter((candidate) => candidate.connectionId === preferred) : [];
      if (preferred && !preferredScopes.some((candidate) => candidate.availability === "ready" && candidate.hasFacts)) {
        const selectedConnectionUnavailable = preferredScopes.length === 0 || preferredScopes.every((candidate) => candidate.availability === "unavailable");
        const replacementReady = candidates.some((candidate) => candidate.connectionId !== preferred && candidate.availability === "ready" && candidate.hasFacts);
        if (selectedConnectionUnavailable && !replacementReady) {
          if (connectionCandidates.length) needsData.push({ localLocationId, channel, candidates: connectionCandidates });
          continue;
        }
        conflicts.push({ localLocationId, channel, expectedVersion, candidates: connectionCandidates });
        continue;
      }
      const factualCandidates = candidates.filter((candidate) => candidate.hasFacts);
      if (!preferred && factualCandidates.some((candidate) => candidate.availability !== "ready")) {
        conflicts.push({ localLocationId, channel, expectedVersion, candidates: connectionCandidates });
        continue;
      }
      const readyCandidates = factualCandidates.filter((candidate) => candidate.availability === "ready");
      if (!readyCandidates.length) {
        if (connectionCandidates.length) needsData.push({ localLocationId, channel, candidates: connectionCandidates });
        continue;
      }
      const { resolution, selectedScopes } = selectAuthoritativeReportScopes({ candidates, preferredConnectionId: preferred });
      if (resolution.selected) {
        authoritativeConnectionIds.add(resolution.selected.connectionId);
        for (const selectedScope of selectedScopes) {
          selections.push({
            localLocationId,
            channel,
            connectionId: selectedScope.connectionId,
            provider: selectedScope.provider,
            metricLocationRef: selectedScope.metricLocationRef ?? null,
            externalOutletRef: selectedScope.externalOutletRef ?? null,
            accountName: selectedScope.accountName ?? null,
            mode: resolution.status,
          });
        }
      } else if (resolution.status === "conflict") {
        conflicts.push({ localLocationId, channel, expectedVersion, candidates: connectionCandidates });
      }
    }
  }
  return {
    status: conflicts.length ? "conflict" as const : needsData.length ? "needs_data" as const : "ready" as const,
    authoritativeConnectionIds: [...authoritativeConnectionIds],
    conflicts,
    selections,
    candidates: allCandidates,
    needsData,
  };
}
