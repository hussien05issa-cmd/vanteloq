import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../db/index.ts";
import { integrationConnections } from "../../db/schema.ts";
import { ApiError } from "../api.ts";

export async function requireOwnedIntegrationConnection(
  organizationId: string,
  provider: string,
  requestedConnectionId: string | null | undefined,
  options: { connected?: boolean } = {},
) {
  const rows = await getDb().select().from(integrationConnections).where(and(
    eq(integrationConnections.organizationId, organizationId),
    eq(integrationConnections.provider, provider),
    ...(options.connected ? [eq(integrationConnections.status, "connected" as const)] : []),
  ));
  if (requestedConnectionId) {
    const connection = rows.find((row) => row.id === requestedConnectionId);
    if (!connection) throw new ApiError(404, "INTEGRATION_CONNECTION_NOT_FOUND", "The selected provider account is unavailable.");
    return connection;
  }
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new ApiError(409, "INTEGRATION_NOT_CONNECTED", "Connect the provider account before using this action.");
  throw new ApiError(409, "INTEGRATION_CONNECTION_REQUIRED", "Choose the provider account for this action.");
}

export type IntegrationSyncLease = {
  connectionId: string;
  organizationId: string;
  provider: string;
  owner: string;
  version: number;
  expiresAt: Date;
};

export function sqliteTimestampSeconds(milliseconds = Date.now()) {
  return Math.floor(milliseconds / 1_000);
}

export async function acquireIntegrationSyncLease(
  organizationId: string,
  provider: string,
  connectionId: string,
  ttlMs = 5 * 60_000,
): Promise<IntegrationSyncLease | null> {
  const owner = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = new Date(now + ttlMs);
  const nowSeconds = sqliteTimestampSeconds(now);
  const expiresAtSeconds = sqliteTimestampSeconds(expiresAt.getTime());
  const result = await getD1().prepare(`
    UPDATE integration_connections
    SET sync_lease_owner = ?, sync_lease_expires_at = ?, sync_version = sync_version + 1, updated_at = ?
    WHERE id = ? AND organization_id = ? AND provider = ?
      AND (sync_lease_owner IS NULL OR sync_lease_expires_at IS NULL OR sync_lease_expires_at <= ?)
  `).bind(owner, expiresAtSeconds, nowSeconds, connectionId, organizationId, provider, nowSeconds).run();
  if (Number(result.meta.changes ?? 0) !== 1) return null;

  const row = await getD1().prepare(`
    SELECT sync_version AS version
    FROM integration_connections
    WHERE id = ? AND organization_id = ? AND provider = ? AND sync_lease_owner = ?
  `).bind(connectionId, organizationId, provider, owner).first<{ version: number }>();
  if (!row) return null;
  return { connectionId, organizationId, provider, owner, version: Number(row.version), expiresAt };
}

export async function renewIntegrationSyncLease(
  lease: IntegrationSyncLease,
  ttlMs = 5 * 60_000,
) {
  const now = Date.now();
  const expiresAt = new Date(now + ttlMs);
  const nowSeconds = sqliteTimestampSeconds(now);
  const result = await getD1().prepare(`
    UPDATE integration_connections
    SET sync_lease_expires_at = ?, updated_at = ?
    WHERE id = ? AND organization_id = ? AND provider = ?
      AND sync_lease_owner = ? AND sync_version = ? AND sync_lease_expires_at > ?
  `).bind(
    sqliteTimestampSeconds(expiresAt.getTime()), nowSeconds,
    lease.connectionId, lease.organizationId, lease.provider,
    lease.owner, lease.version, nowSeconds,
  ).run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new ApiError(409, "INTEGRATION_SYNC_LEASE_LOST", "This synchronization was superseded before it could safely publish data.");
  }
  lease.expiresAt = expiresAt;
  return lease;
}

export async function releaseIntegrationSyncLease(lease: IntegrationSyncLease) {
  await getD1().prepare(`
    UPDATE integration_connections
    SET sync_lease_owner = NULL, sync_lease_expires_at = NULL, updated_at = ?
    WHERE id = ? AND organization_id = ? AND provider = ?
      AND sync_lease_owner = ? AND sync_version = ?
  `).bind(
    sqliteTimestampSeconds(), lease.connectionId, lease.organizationId, lease.provider, lease.owner, lease.version,
  ).run();
}
