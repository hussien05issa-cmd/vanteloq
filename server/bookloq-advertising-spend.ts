import { getD1 } from "../db";
import { buildBookloqAdvertisingSpend, type AdvertisingBudget, type AdvertisingSpendRow } from "../domain/bookloq-advertising-spend";
import type { AccessContext } from "./authorization";
import { getTenantEntitlements } from "./entitlements/engine";

export async function readBookloqAdvertisingRows(database: D1Database, organizationId: string,
  locationId: string | null, period: { start: string; end: string }) {
  return (await database.prepare(`SELECT s.id selectionId, s.external_resource_ref accountRef,
    s.external_resource_name accountName, s.scope_kind scopeKind, s.local_location_id locationId,
    m.metric_date metricDate, m.money_amount_minor amountMinor, m.money_currency currency,
    m.reporting_timezone reportingTimezone, m.updated_at updatedAt, c.last_successful_sync_at lastSyncedAt,
    EXISTS (SELECT 1 FROM marketing_resource_selections other
      JOIN integration_connections other_connection ON other_connection.id = other.connection_id
        AND other_connection.organization_id = other.organization_id AND other_connection.provider = 'meta'
      WHERE other.organization_id = s.organization_id AND other.provider = 'meta' AND other.dataset = 'meta_ads'
        AND other.external_resource_ref = s.external_resource_ref
        AND (other.scope_kind <> s.scope_kind OR COALESCE(other.local_location_id, '') <> COALESCE(s.local_location_id, ''))
        AND other_connection.status = 'connected' AND other_connection.data_promotion_status = 'approved') scopeConflict
    FROM marketing_resource_selections s
    JOIN integration_connections c ON c.id = s.connection_id AND c.organization_id = s.organization_id AND c.provider = s.provider
    LEFT JOIN marketing_daily_metrics m ON m.resource_selection_id = s.id AND m.metric_key = 'meta_spend'
      AND m.metric_date BETWEEN ? AND ?
    WHERE s.organization_id = ? AND s.provider = 'meta' AND s.dataset = 'meta_ads'
      AND c.status = 'connected' AND c.data_promotion_status = 'approved' AND c.sync_lease_owner IS NULL AND c.last_error_code IS NULL
      ${locationId ? "AND s.scope_kind = 'location' AND s.local_location_id = ?" : ""}
    ORDER BY s.external_resource_ref, m.metric_date, s.id LIMIT 25001`)
    .bind(period.start, period.end, organizationId, ...(locationId ? [locationId] : []))
    .all<AdvertisingSpendRow>()).results ?? [];
}

export async function loadBookloqAdvertisingSpend(context: AccessContext, input: {
  baseCurrency: string; locationId: string | null; budgets: AdvertisingBudget[];
  allowed: boolean; dataMode: string; nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const period = { start: new Date(nowMs - 89 * 86_400_000).toISOString().slice(0, 10), end: new Date(nowMs).toISOString().slice(0, 10) };
  const common = { baseCurrency: input.baseCurrency, budgets: input.budgets, period, nowSeconds: Math.floor(nowMs / 1000) };
  if (!input.allowed) return buildBookloqAdvertisingSpend({ ...common, rows: [], restricted: true });
  if (input.dataMode !== "live") return buildBookloqAdvertisingSpend({ ...common, rows: [], unavailableReason: "Live advertising evidence is excluded from demonstration books." });
  const entitlements = await getTenantEntitlements(context);
  if (!entitlements.features.includes("marketing.meta_ads")) return buildBookloqAdvertisingSpend({ ...common, rows: [], restricted: true });
  const rows = await readBookloqAdvertisingRows(getD1(), context.organizationId, input.locationId, period);
  if (rows.length > 25000) return buildBookloqAdvertisingSpend({ ...common, rows: [], unavailableReason: "Advertising evidence exceeds the safe reporting limit. No partial total is shown." });
  return buildBookloqAdvertisingSpend({ ...common, rows });
}
