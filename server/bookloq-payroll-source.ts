import { getD1 } from "../db";
import { buildBookloqPayrollSource, emptyBookloqPayrollSource, type PayrollSourceRow } from "../domain/bookloq-payroll-source";
import type { AccessContext } from "./authorization";
import { ApiError } from "./api";
import { requireFeature } from "./entitlements/engine";
import { deelReadiness } from "./integrations/deel";
import { requireIntegrationProviderAccess } from "./integrations/free-selection";
import { requireIntegrationRollout } from "./integrations/rollout-access";

/** Metadata only: never select provider values_json, employee data or money. */
export async function readBookloqPayrollSourceRows(database: D1Database, organizationId: string, locationId: string | null) {
  return (await database.prepare(`WITH mapped AS (
    SELECT m.connection_id, m.external_location_ref, m.local_location_id
    FROM integration_location_mappings m JOIN organization_locations l
      ON l.id = m.local_location_id AND l.organization_id = m.organization_id
    WHERE m.organization_id = ? AND m.provider = 'deel' AND m.status = 'mapped'
      ${locationId ? "AND m.local_location_id = ?" : ""}
  )
  SELECT c.id, c.external_account_name accountName, c.status, c.data_promotion_status promotionStatus,
    c.last_successful_sync_at lastSuccessfulSyncAt, c.last_error_code lastErrorCode, c.sync_lease_owner syncLeaseOwner,
    (SELECT COUNT(DISTINCT local_location_id) FROM mapped WHERE connection_id = c.id) mappedLocationCount,
    (SELECT status FROM integration_sync_runs WHERE organization_id = c.organization_id AND provider = 'deel'
      AND connection_id = c.id AND started_at >= COALESCE(c.connected_at, 0) ORDER BY started_at DESC, id DESC LIMIT 1) latestSyncStatus,
    (SELECT warning_count FROM integration_sync_runs WHERE organization_id = c.organization_id AND provider = 'deel'
      AND connection_id = c.id AND started_at >= COALESCE(c.connected_at, 0) ORDER BY started_at DESC, id DESC LIMIT 1) latestWarningCount,
    r.id reportId, r.period_from periodFrom, r.period_to periodTo, r.updated_at importedAtMs
  FROM integration_connections c LEFT JOIN retail_measurements r
    ON r.organization_id = c.organization_id AND r.connection_id = c.id AND r.provider = 'deel' AND r.kind = 'labour'
    AND r.reference LIKE 'deel-payroll-cycle:%' AND r.source_label = 'Deel available payroll-report aggregate'
    AND c.status = 'connected' AND c.data_promotion_status IN ('staging', 'approved')
    AND c.last_error_code IS NULL AND c.sync_lease_owner IS NULL AND c.last_successful_sync_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM mapped m WHERE m.connection_id = c.id AND r.outlet_ref =
      CASE WHEN c.source_namespace = 'legacy' THEN m.external_location_ref ELSE c.source_namespace || ':' || m.external_location_ref END)
  WHERE c.organization_id = ? AND c.provider = 'deel' AND c.status IN ('connected', 'pending', 'error')
    ${locationId ? "AND EXISTS (SELECT 1 FROM mapped WHERE connection_id = c.id)" : ""}
  ORDER BY c.id, r.period_to DESC, r.id LIMIT 10001`)
    .bind(organizationId, ...(locationId ? [locationId] : []), organizationId).all<PayrollSourceRow>()).results ?? [];
}

export async function loadBookloqPayrollSource(context: AccessContext, input: {
  allowed: boolean; dataMode: string; locationId: string | null;
}) {
  // Exit before any source or entitlement reads for callers without source permissions.
  if (!input.allowed || !["owner", "admin", "manager"].includes(context.role)) return emptyBookloqPayrollSource("restricted");
  if (input.dataMode !== "live") return emptyBookloqPayrollSource("unavailable", "Live Deel evidence is excluded from demonstration books.");
  try {
    await requireIntegrationRollout(context, "deel");
    await requireFeature(context, "business.settings");
    await requireIntegrationProviderAccess(context, "deel");
  } catch (error) {
    if (error instanceof ApiError && error.code === "INTEGRATION_COMING_SOON") return emptyBookloqPayrollSource("unavailable", "Deel remains a preview integration. Source review is unavailable for this account.");
    if (error instanceof ApiError && [402, 403].includes(error.status)) return emptyBookloqPayrollSource("restricted");
    throw error;
  }
  const readiness = deelReadiness();
  if (!readiness.productionApproved) return emptyBookloqPayrollSource("unavailable", "The configured Deel production environment is not approved for use.");
  const rows = await readBookloqPayrollSourceRows(getD1(), context.organizationId, input.locationId);
  if (rows.length > 10000) return emptyBookloqPayrollSource("unavailable", "Source evidence exceeds the safe reporting limit. No partial report count is shown.");
  // Preserve the per-connection selection generation gate used by existing provider routes.
  try { for (const id of new Set(rows.map(row => row.id))) await requireIntegrationProviderAccess(context, "deel", id); }
  catch (error) {
    if (error instanceof ApiError && [402, 403].includes(error.status)) return emptyBookloqPayrollSource("restricted");
    throw error;
  }
  return buildBookloqPayrollSource(rows, readiness.environment);
}
