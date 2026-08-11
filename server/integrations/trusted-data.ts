import { sql, type SQLWrapper } from "drizzle-orm";

export function approvedFactSource(
  organizationId: SQLWrapper,
  sourceProvider: SQLWrapper,
  sourceConnectionId: SQLWrapper,
) {
  return sql`(
    ${sourceConnectionId} IS NULL
    OR EXISTS (
      SELECT 1
      FROM integration_connections approved_source
      WHERE approved_source.id = ${sourceConnectionId}
        AND approved_source.organization_id = ${organizationId}
        AND approved_source.provider = ${sourceProvider}
        AND approved_source.status = 'connected'
        AND approved_source.data_promotion_status = 'approved'
        AND (
          approved_source.sync_lease_owner IS NULL
          OR approved_source.sync_lease_expires_at IS NULL
          OR approved_source.sync_lease_expires_at <= CAST(strftime('%s', 'now') AS INTEGER)
        )
    )
  )`;
}

export function approvedCommerceSource(
  organizationId: SQLWrapper,
  provider: SQLWrapper,
  connectionId: SQLWrapper,
) {
  return sql`EXISTS (
    SELECT 1
    FROM integration_connections approved_source
    WHERE approved_source.id = ${connectionId}
      AND approved_source.organization_id = ${organizationId}
      AND approved_source.provider = ${provider}
      AND approved_source.status = 'connected'
      AND approved_source.data_promotion_status = 'approved'
      AND (
        approved_source.sync_lease_owner IS NULL
        OR approved_source.sync_lease_expires_at IS NULL
        OR approved_source.sync_lease_expires_at <= CAST(strftime('%s', 'now') AS INTEGER)
      )
  )`;
}

export function approvedBankSource(
  organizationId: SQLWrapper,
  provider: SQLWrapper,
  externalItemRef: SQLWrapper,
) {
  return sql`(
    ${provider} <> 'plaid'
    OR EXISTS (
      SELECT 1
      FROM integration_connections approved_source
      WHERE approved_source.organization_id = ${organizationId}
        AND approved_source.provider = 'plaid'
        AND approved_source.external_account_ref = ${externalItemRef}
        AND approved_source.status = 'connected'
        AND approved_source.data_promotion_status = 'approved'
        AND (
          approved_source.sync_lease_owner IS NULL
          OR approved_source.sync_lease_expires_at IS NULL
          OR approved_source.sync_lease_expires_at <= CAST(strftime('%s', 'now') AS INTEGER)
        )
    )
  )`;
}

export function noActiveIntegrationLease(owner: SQLWrapper, expiresAt: SQLWrapper) {
  return sql`(
    ${owner} IS NULL
    OR ${expiresAt} IS NULL
    OR ${expiresAt} <= CAST(strftime('%s', 'now') AS INTEGER)
  )`;
}
