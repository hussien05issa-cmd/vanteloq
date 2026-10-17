import { getD1 } from "../../db";
import { integrationCatalog } from "../../app/integration-catalog";
import { ApiError, readJsonObject } from "../api";
import { requireAccess, type AccessContext, type Role } from "../authorization";
import { getTenantEntitlements, requireFeatureEntitlement, resolveComplimentaryEntitlements, resolveInternalEntitlements, resolveSubscriptionEntitlements, subscriptionSnapshot } from "../entitlements/engine";
import { FREE_PLAN } from "../entitlements/catalog";
import { hasFreeEnrollment } from "../entitlements/free";
import { complimentaryGrantForOwner } from "../complimentary-access";
import { getInternalAccessGrant } from "../internal-access";
import { integrationProviderFeature } from "../../domain/paid-feature-routing";
import { requireIntegrationRollout } from "./rollout-access";
import { lightspeedRReadiness } from "./lightspeed-r";
import { squareReadiness } from "./square";
import { slackReadiness } from "./slack";
import { plaidReadiness } from "./plaid";

const reservationSeconds = 600;

function supportedProvider(provider: string) {
  const feature = integrationProviderFeature(provider);
  if (!feature || !integrationCatalog.some(entry => entry.id === provider && entry.availability === "credentials_required")) {
    throw new ApiError(400, "INTEGRATION_PROVIDER_UNAVAILABLE", "Choose an available integration.");
  }
  return feature;
}

// Keep this boundary aligned with getTenantEntitlements: an unpaid subscription
// must stay in billing recovery even when the workspace previously enrolled Free.
export function subscriptionAllowsFreeFallback(status: string | null | undefined) {
  return !status || status === "canceled" || status === "incomplete_expired";
}

// A consumed OAuth state can still be exchanging its code. Retain it for one
// bounded exchange window, as well as the brief insert-before-state interval.
const pendingAttempt = `(c.status='pending' AND (c.updated_at>? OR EXISTS (
  SELECT 1 FROM integration_oauth_states o WHERE o.connection_id=c.id
    AND o.organization_id=c.organization_id AND o.provider=c.provider
    AND ((o.consumed_at IS NULL AND o.expires_at>?) OR o.consumed_at>?)
)))`;
const occupiedConnection = `(c.status='connected' OR EXISTS (
  SELECT 1 FROM integration_secrets k WHERE k.connection_id=c.id
    AND k.organization_id=c.organization_id AND k.provider=c.provider
) OR ${pendingAttempt})`;

/** One provider occupies one slot, including live attempts and repairable accounts. */
export async function reserveFreeIntegration(database: D1Database, organizationId: string, provider: string, now = Math.floor(Date.now() / 1000)) {
  supportedProvider(provider);
  await cleanupFreeSelections(database, organizationId, now);
  const row = await database.prepare(`INSERT INTO free_integration_selections (organization_id,provider,grant_id,created_at,expires_at)
    SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM free_integration_selections WHERE organization_id=? AND provider=?)
      OR (SELECT COUNT(*) FROM free_integration_selections WHERE organization_id=?)<?
    ON CONFLICT(organization_id,provider) DO UPDATE SET expires_at=excluded.expires_at
    RETURNING grant_id`).bind(organizationId, provider, crypto.randomUUID(), now, now + reservationSeconds,
      organizationId, provider, organizationId, FREE_PLAN.integrationProviders).first<{grant_id:string}>();
  if (!row) throw new ApiError(402, "FREE_INTEGRATION_LIMIT", "Free includes two integrations of your choice. Disconnect a selected provider to make room, or upgrade in Settings > Billing & plans. Your saved records stay available.");
  return row.grant_id;
}

export async function cleanupFreeSelections(database: D1Database, organizationId: string, now = Math.floor(Date.now() / 1000)) {
  const recent = now - reservationSeconds;
  // Revoke abandoned Free attempts in the same transaction that releases their
  // slot, so an already-started callback cannot finalize a released generation.
  await database.batch([
    database.prepare(`UPDATE integration_connections AS c SET status='revoked', data_promotion_status='blocked',
      promotion_authorized_at=NULL, last_error_code='INTEGRATION_ATTEMPT_EXPIRED', updated_at=?
      WHERE c.organization_id=? AND c.status IN ('pending','error') AND NOT ${occupiedConnection}
        AND EXISTS (SELECT 1 FROM free_integration_selections s WHERE s.organization_id=c.organization_id
          AND s.provider=c.provider AND s.grant_id=c.free_grant_id AND s.expires_at<=?)`)
      .bind(now, organizationId, recent, now, recent, now),
    database.prepare(`DELETE FROM free_integration_selections AS s WHERE organization_id=? AND expires_at<=?
      AND NOT EXISTS (SELECT 1 FROM integration_connections c WHERE c.organization_id=s.organization_id
        AND c.provider=s.provider AND ${occupiedConnection})`)
      .bind(organizationId, now, recent, now, recent),
  ]);
}

export async function releaseIntegrationSelectionIfUnused(organizationId: string, provider: string, database = getD1(), now = Math.floor(Date.now() / 1000)) {
  await database.batch([
    database.prepare(`UPDATE integration_connections AS c SET status='revoked', data_promotion_status='blocked',
      promotion_authorized_at=NULL, last_error_code='INTEGRATION_ATTEMPT_EXPIRED', updated_at=?
      WHERE c.organization_id=? AND c.provider=? AND c.status IN ('pending','error') AND NOT ${occupiedConnection}
        AND EXISTS (SELECT 1 FROM free_integration_selections s WHERE s.organization_id=c.organization_id
          AND s.provider=c.provider AND s.grant_id=c.free_grant_id)`)
      .bind(now, organizationId, provider, now - reservationSeconds, now, now - reservationSeconds),
    database.prepare(`DELETE FROM free_integration_selections WHERE organization_id=? AND provider=?
    AND NOT EXISTS (SELECT 1 FROM integration_connections c WHERE c.organization_id=? AND c.provider=?
      AND ${occupiedConnection})`)
      .bind(organizationId, provider, organizationId, provider, now - reservationSeconds, now, now - reservationSeconds),
  ]);
}

export async function freeIntegrationSelection(organizationId: string, provider: string) {
  return getD1().prepare("SELECT grant_id FROM free_integration_selections WHERE organization_id=? AND provider=?")
    .bind(organizationId, provider).first<{grant_id:string}>();
}

export async function freeIntegrationAllowance(organizationId: string) {
  await cleanupFreeSelections(getD1(), organizationId);
  const rows = (await getD1().prepare("SELECT provider FROM free_integration_selections WHERE organization_id=? ORDER BY provider")
    .bind(organizationId).all<{provider:string}>()).results ?? [];
  return { limit: FREE_PLAN.integrationProviders, used: rows.length, selectedProviders: rows.map(row => row.provider) };
}

export async function requireFreeIntegrationSelection(organizationId: string, provider: string, connectionId?: string, database = getD1()) {
  const grant = await database.prepare("SELECT grant_id FROM free_integration_selections WHERE organization_id=? AND provider=?")
    .bind(organizationId, provider).first<{grant_id:string}>();
  if (!grant) throw new ApiError(403, "FREE_INTEGRATION_SELECTION_REQUIRED", "Choose this provider in Integrations & data before using it.");
  if (connectionId) {
    const connection = await database.prepare("SELECT free_grant_id FROM integration_connections WHERE id=? AND organization_id=? AND provider=?")
      .bind(connectionId, organizationId, provider).first<{free_grant_id:string|null}>();
    // A null generation is an existing paid connection explicitly selected after
    // downgrade. New Free attempts must obtain a non-null integrationGrantId.
    if (!connection || (connection.free_grant_id !== null && connection.free_grant_id !== grant.grant_id)) {
      throw new ApiError(403, "FREE_INTEGRATION_SELECTION_CHANGED", "This connection attempt is no longer selected. Start again in Integrations & data.");
    }
  }
  return grant.grant_id;
}

export async function requireIntegrationProviderAccess(context: AccessContext, provider: string, connectionId?: string) {
  const feature = supportedProvider(provider);
  const access = await getTenantEntitlements(context);
  if (access.accessType !== "free") { requireFeatureEntitlement(access, feature); return; }
  await requireFreeIntegrationSelection(context.organizationId, provider, connectionId);
}

/** Only call after verifying OAuth state, browser binding and its current actor. */
export async function requireIntegrationCallbackAccess(context: AccessContext, provider: string, connectionId: string) {
  const feature = supportedProvider(provider);
  // The authorization endpoint verified MFA. A callback is a continuation of
  // that saved grant, not a fresh user session and must not invent an AAL claim.
  const internal = await getInternalAccessGrant(context);
  if (internal) { requireFeatureEntitlement(resolveInternalEntitlements(internal), feature); return; }
  const complimentary = context.role === "owner" && context.identity.provider === "supabase" && context.authProvider === "supabase"
    && context.identity.emailVerified && context.identity.subject === context.authSubject
    ? await complimentaryGrantForOwner({ userId: context.userId, organizationId: context.organizationId,
      authSubject: context.authSubject, email: context.identity.email }) : null;
  if (complimentary) { requireFeatureEntitlement(resolveComplimentaryEntitlements(complimentary), feature); return; }
  const snapshot = await subscriptionSnapshot(context.organizationId);
  const paid = resolveSubscriptionEntitlements(snapshot);
  if (paid.accessType === "none" && subscriptionAllowsFreeFallback(snapshot.status)
    && context.role === "owner" && await hasFreeEnrollment(context.organizationId)) {
    await requireFreeIntegrationSelection(context.organizationId, provider, connectionId);
    return;
  }
  requireFeatureEntitlement(paid, feature);
}

export async function integrationRequestConnectionId(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") {
    const params = new URL(request.url).searchParams;
    return params.get("connection") || params.get("connectionId") || undefined;
  }
  if (!request.body) return undefined;
  const body = await readJsonObject(request.clone());
  return typeof body.connectionId === "string" && body.connectionId ? body.connectionId : undefined;
}

export async function requireIntegrationAccess(request: Request, roles: readonly Role[], provider: string, starting = false) {
  const context = await requireAccess(request, roles, "business.settings");
  supportedProvider(provider);
  if (starting) await requireIntegrationRollout(context, provider);
  const access = await getTenantEntitlements(context);
  if (access.accessType !== "free") requireFeatureEntitlement(access, supportedProvider(provider));
  else if (!starting) {
    let connectionId = await integrationRequestConnectionId(request);
    if (!connectionId) {
      // Single-account routes may omit the identifier. Validate their existing
      // account too, so omitting connectionId cannot bypass a stale generation.
      const active = (await getD1().prepare("SELECT id FROM integration_connections WHERE organization_id=? AND provider=? AND status IN ('connected','error')")
        .bind(context.organizationId, provider).all<{id:string}>()).results ?? [];
      if (active.length === 1) connectionId = active[0].id;
      else if (active.length > 1) {
        for (const connection of active) await requireFreeIntegrationSelection(context.organizationId, provider, connection.id);
      }
    }
    await requireFreeIntegrationSelection(context.organizationId, provider, connectionId);
  }
  return context;
}

export async function reserveIntegrationSelection(context: AccessContext, provider: string) {
  supportedProvider(provider);
  if ((await getTenantEntitlements(context)).accessType !== "free") return null;
  await requireIntegrationRollout(context, provider);
  const readiness = provider === "square" ? squareReadiness() : provider === "lightspeed-r" ? lightspeedRReadiness()
    : provider === "slack" ? slackReadiness() : provider === "plaid" ? plaidReadiness() : null;
  if (!readiness?.credentialsConfigured) throw new ApiError(503, "INTEGRATION_PROVIDER_UNAVAILABLE", "This integration is not available for new connections yet.");
  return reserveFreeIntegration(getD1(), context.organizationId, provider);
}

export async function integrationGrantId(context: AccessContext, provider: string) {
  return (await getTenantEntitlements(context)).accessType === "free"
    ? requireFreeIntegrationSelection(context.organizationId, provider) : null;
}
