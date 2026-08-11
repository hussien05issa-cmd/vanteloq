import { eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { integrationConnections } from "../../../../db/schema";
import { requireAccess } from "../../../../server/authorization";
import { handleApi, jsonResponse } from "../../../../server/api";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { integrationCatalog, preSyncControls } from "../../../integration-catalog";
import { lightspeedReadiness } from "../../../../server/integrations/lightspeed";
import { lightspeedRReadiness } from "../../../../server/integrations/lightspeed-r";
import { stripeReadiness } from "../../../../server/integrations/stripe";
import { plaidReadiness } from "../../../../server/integrations/plaid";
import { buildProviderFeatureCoverage, type CanonicalCommerceCoverage } from "../../../../domain/provider-feature-coverage";

function maskedAccountRef(value: string | null | undefined) {
  if (!value) return null;
  const ending = value.slice(-4);
  return `•••• ${ending}`;
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, ["owner", "admin", "manager", "employee", "read_only"]);
    await requirePermission(context, "integrations.view");
    const permissions = await effectivePermissions(context);
    const rows = await getDb()
      .select({
        provider: integrationConnections.provider,
        status: integrationConnections.status,
        externalAccountRef: integrationConnections.externalAccountRef,
        externalAccountName: integrationConnections.externalAccountName,
        lastSuccessfulSyncAt: integrationConnections.lastSuccessfulSyncAt,
        lastErrorCode: integrationConnections.lastErrorCode,
        connectedAt: integrationConnections.connectedAt,
        dataPromotionStatus: integrationConnections.dataPromotionStatus,
      })
      .from(integrationConnections)
      .where(eq(integrationConnections.organizationId, context.organizationId));
    const byProvider = new Map(rows.map((row) => [row.provider, row]));
    const database = getD1();
    const coverageRows = await Promise.all(integrationCatalog.map(async (provider) => {
      const connection = byProvider.get(provider.id);
      const promoted = connection?.status === "connected" && connection.dataPromotionStatus === "approved";
      if (!promoted) {
        const coverage: CanonicalCommerceCoverage = { sales: false, payments: false, products: false, inventory: false, customers: false, suppliers: false, locations: false };
        return [provider.id, coverage] as const;
      }
      const facts = await database.prepare(`
        SELECT
          (SELECT COUNT(*) FROM commerce_sale_lines WHERE organization_id = ? AND provider = ?) AS sales,
          (SELECT COUNT(*) FROM commerce_payments WHERE organization_id = ? AND provider = ?) AS payments,
          (SELECT COUNT(*) FROM commerce_products WHERE organization_id = ? AND provider = ? AND archived = 0) AS products,
          (SELECT COUNT(*) FROM commerce_customers WHERE organization_id = ? AND provider = ? AND archived = 0) AS customers,
          (SELECT COUNT(*) FROM commerce_suppliers WHERE organization_id = ? AND provider = ? AND archived = 0) AS suppliers,
          (SELECT COUNT(*) FROM integration_location_mappings WHERE organization_id = ? AND provider = ? AND status = 'mapped') AS locations,
          (SELECT COUNT(*) FROM inventory_balances b
             WHERE b.organization_id = ? AND EXISTS (
               SELECT 1 FROM integration_location_mappings m
               WHERE m.organization_id = b.organization_id AND m.provider = ? AND m.status = 'mapped'
                 AND (b.location_ref = m.external_location_ref OR b.location_ref = m.provider || ':' || m.external_location_ref)
             )) AS inventory
      `).bind(
        context.organizationId, provider.id,
        context.organizationId, provider.id,
        context.organizationId, provider.id,
        context.organizationId, provider.id,
        context.organizationId, provider.id,
        context.organizationId, provider.id,
        context.organizationId, provider.id,
      ).first<Record<keyof CanonicalCommerceCoverage, number>>();
      const coverage: CanonicalCommerceCoverage = {
        sales: Number(facts?.sales ?? 0) > 0,
        payments: Number(facts?.payments ?? 0) > 0,
        products: Number(facts?.products ?? 0) > 0,
        inventory: Number(facts?.inventory ?? 0) > 0,
        customers: Number(facts?.customers ?? 0) > 0,
        suppliers: Number(facts?.suppliers ?? 0) > 0,
        locations: Number(facts?.locations ?? 0) > 0,
      };
      return [provider.id, coverage] as const;
    }));
    const coverageByProvider = new Map(coverageRows);
    const syncEnabled = rows.some((row) => row.status === "connected");
    const dataPromotionEnabled = rows.some((row) => row.dataPromotionStatus === "approved");
    return jsonResponse({
      preSyncControls,
      syncEnabled,
      dataPromotionEnabled,
      canManage: permissions.includes("integrations.manage"),
      integrations: integrationCatalog.map((provider) => {
        const canonicalCoverage = coverageByProvider.get(provider.id)!;
        const canManageProvider = provider.id === "plaid"
          ? permissions.includes("finance.connections")
          : permissions.includes("integrations.manage");
        return ({
        ...provider,
        canManage: canManageProvider,
        status: byProvider.get(provider.id)?.status ?? "not_connected",
        maskedAccountRef: maskedAccountRef(byProvider.get(provider.id)?.externalAccountRef),
        externalAccountName: byProvider.get(provider.id)?.externalAccountName ?? null,
        lastSuccessfulSyncAt: byProvider.get(provider.id)?.lastSuccessfulSyncAt ?? null,
        lastErrorCode: byProvider.get(provider.id)?.lastErrorCode ?? null,
        connectedAt: byProvider.get(provider.id)?.connectedAt ?? null,
        dataPromotionStatus: byProvider.get(provider.id)?.dataPromotionStatus ?? "blocked",
        providerReadiness: provider.id === "lightspeed"
          ? lightspeedReadiness()
          : provider.id === "lightspeed-r"
            ? lightspeedRReadiness()
            : provider.id === "stripe"
              ? stripeReadiness()
              : provider.id === "plaid"
                ? plaidReadiness()
              : null,
        canonicalCoverage,
        featureCoverage: buildProviderFeatureCoverage(provider.id, canonicalCoverage),
      });}),
    });
  });
}
