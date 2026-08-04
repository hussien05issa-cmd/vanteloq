import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { integrationConnections } from "../../../../db/schema";
import { requireAccess } from "../../../../server/authorization";
import { handleApi, jsonResponse } from "../../../../server/api";
import { requirePermission } from "../../../../server/permissions";

const providers = [
  { id: "lightspeed", name: "Lightspeed", category: "Point of sale", availability: "configuration_required" },
  { id: "square", name: "Square", category: "Point of sale", availability: "configuration_required" },
  { id: "moneris", name: "Moneris", category: "Payments", availability: "planned" },
  { id: "shopify", name: "Shopify POS", category: "Commerce", availability: "configuration_required" },
  { id: "google-business", name: "Google Business Profile", category: "Local presence", availability: "configuration_required" },
  { id: "quickbooks", name: "QuickBooks", category: "Accounting", availability: "planned" },
  { id: "plaid", name: "Plaid", category: "Banking", availability: "configuration_required" },
  { id: "mx", name: "MX", category: "Banking", availability: "configuration_required" },
  { id: "flinks", name: "Flinks", category: "Canadian banking", availability: "configuration_required" },
  { id: "manual-bank", name: "Manual bank statements", category: "Banking", availability: "planned" },
] as const;

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, ["owner", "admin", "manager", "employee", "read_only"]);
    await requirePermission(context, "integrations.view");
    const rows = await getDb()
      .select({
        provider: integrationConnections.provider,
        status: integrationConnections.status,
        lastSuccessfulSyncAt: integrationConnections.lastSuccessfulSyncAt,
        lastErrorCode: integrationConnections.lastErrorCode,
      })
      .from(integrationConnections)
      .where(eq(integrationConnections.organizationId, context.organizationId));
    const byProvider = new Map(rows.map((row) => [row.provider, row]));
    return jsonResponse({
      integrations: providers.map((provider) => ({
        ...provider,
        status: byProvider.get(provider.id)?.status ?? "not_connected",
        lastSuccessfulSyncAt: byProvider.get(provider.id)?.lastSuccessfulSyncAt ?? null,
        lastErrorCode: byProvider.get(provider.id)?.lastErrorCode ?? null,
      })),
    });
  });
}
