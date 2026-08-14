import { getD1 } from "../../../../db";
import { requireAccess } from "../../../../server/authorization";
import { handleApi, jsonResponse } from "../../../../server/api";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { authorizedLocationDataScope } from "../../../../server/location-access";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers);
    await requirePermission(context, "dashboard.view");
    const permissions = await effectivePermissions(context);
    const canReadCustomerIdentity = permissions.includes("customers.identity");
    const canReadCustomerTotals = permissions.includes("customers.totals") || canReadCustomerIdentity;
    const canReadProductCosts = permissions.includes("inventory.value") || permissions.includes("finance.costs");
    const canReadProfit = permissions.includes("metrics.profit");
    const canReadSuppliers = permissions.includes("purchasing.view");
    const canReadInventory = permissions.includes("inventory.view");
    const database = getD1();
    const squareCostGap = await database.prepare(`
      SELECT 1 AS value FROM integration_connections
      WHERE organization_id = ? AND provider = 'square' AND status = 'connected'
        AND data_promotion_status = 'approved' AND last_error_code = 'SQUARE_PRODUCT_COST_UNAVAILABLE'
      LIMIT 1
    `).bind(context.organizationId).first<{ value: number }>();
    const canViewVerifiedProfit = canReadProfit && !squareCostGap;
    const requestedLocationId = new URL(request.url).searchParams.get("location");
    const locationAccess = await authorizedLocationDataScope(context, requestedLocationId);
    const selectedLocation = locationAccess.selectedLocation;
    const providerLocations = locationAccess.providerLocations ?? [];
    const locationRestricted = locationAccess.locationRefs !== null;
    const locationPredicate = (alias: string) => providerLocations
      .map(() => `(${alias}.provider = ? AND ${alias}.connection_id = ? AND ${alias}.outlet_ref = ?)`)
      .join(" OR ");
    const locationBindings = providerLocations.flatMap((location) => [
      location.provider,
      location.connectionId,
      location.externalLocationRef,
    ]);
    const blockedScope = Boolean(locationRestricted && !providerLocations.length);
    const approvedConnectionScope = (alias: string) => ` AND EXISTS (
      SELECT 1 FROM integration_connections approved
      WHERE approved.id = ${alias}.connection_id
        AND approved.organization_id = ${alias}.organization_id
        AND approved.status = 'connected'
        AND approved.data_promotion_status = 'approved'
    )`;
    const approvedProduct = approvedConnectionScope("p");
    const approvedCustomer = approvedConnectionScope("c");
    const approvedSupplier = approvedConnectionScope("s");
    const approvedSale = approvedConnectionScope("l");
    const productScope = locationRestricted
      ? blockedScope ? " AND 0 = 1" : ` AND EXISTS (SELECT 1 FROM commerce_sale_lines scope_line WHERE scope_line.organization_id = p.organization_id AND scope_line.provider = p.provider AND scope_line.connection_id = p.connection_id AND scope_line.product_ref = p.external_product_id AND (${locationPredicate("scope_line")}))`
      : "";
    const customerScope = locationRestricted
      ? blockedScope ? " AND 0 = 1" : ` AND EXISTS (SELECT 1 FROM commerce_sale_lines scope_line WHERE scope_line.organization_id = c.organization_id AND scope_line.provider = c.provider AND scope_line.connection_id = c.connection_id AND scope_line.customer_ref = c.external_customer_id AND (${locationPredicate("scope_line")}))`
      : "";
    const supplierScope = locationRestricted
      ? blockedScope ? " AND 0 = 1" : ` AND EXISTS (SELECT 1 FROM commerce_products scope_product JOIN commerce_sale_lines scope_line ON scope_line.organization_id = scope_product.organization_id AND scope_line.provider = scope_product.provider AND scope_line.connection_id = scope_product.connection_id AND scope_line.product_ref = scope_product.external_product_id WHERE scope_product.organization_id = s.organization_id AND scope_product.provider = s.provider AND scope_product.connection_id = s.connection_id AND scope_product.supplier_ref = s.external_supplier_id AND (${locationPredicate("scope_line")}))`
      : "";
    const saleScope = locationRestricted
      ? blockedScope ? " AND 0 = 1" : ` AND (${locationPredicate("l")})`
      : "";
    const bindScope = locationRestricted && !blockedScope ? locationBindings : [];
    const [productCount, customerCount, supplierCount, saleCount, productSources, customerSources, supplierSources, saleSources, products, customers, suppliers, topProducts] = await Promise.all([
      database.prepare(`SELECT COUNT(*) value FROM commerce_products p WHERE p.organization_id = ? AND p.archived = 0${approvedProduct}${productScope}`).bind(context.organizationId, ...bindScope).first<{ value: number }>(),
      database.prepare(`SELECT COUNT(*) value FROM commerce_customers c WHERE c.organization_id = ? AND c.archived = 0${approvedCustomer}${customerScope}`).bind(context.organizationId, ...bindScope).first<{ value: number }>(),
      database.prepare(`SELECT COUNT(*) value FROM commerce_suppliers s WHERE s.organization_id = ? AND s.archived = 0${approvedSupplier}${supplierScope}`).bind(context.organizationId, ...bindScope).first<{ value: number }>(),
      database.prepare(`SELECT COUNT(*) value FROM commerce_sale_lines l WHERE l.organization_id = ?${approvedSale}${saleScope}`).bind(context.organizationId, ...bindScope).first<{ value: number }>(),
      database.prepare(`SELECT p.provider, COUNT(*) value FROM commerce_products p WHERE p.organization_id = ? AND p.archived = 0${approvedProduct}${productScope} GROUP BY p.provider`).bind(context.organizationId, ...bindScope).all<{ provider: string; value: number }>(),
      database.prepare(`SELECT c.provider, COUNT(*) value FROM commerce_customers c WHERE c.organization_id = ? AND c.archived = 0${approvedCustomer}${customerScope} GROUP BY c.provider`).bind(context.organizationId, ...bindScope).all<{ provider: string; value: number }>(),
      database.prepare(`SELECT s.provider, COUNT(*) value FROM commerce_suppliers s WHERE s.organization_id = ? AND s.archived = 0${approvedSupplier}${supplierScope} GROUP BY s.provider`).bind(context.organizationId, ...bindScope).all<{ provider: string; value: number }>(),
      database.prepare(`SELECT l.provider, COUNT(*) value FROM commerce_sale_lines l WHERE l.organization_id = ?${approvedSale}${saleScope} GROUP BY l.provider`).bind(context.organizationId, ...bindScope).all<{ provider: string; value: number }>(),
      database.prepare(`
        SELECT provider, external_product_id AS externalProductId, sku, name, category_ref AS categoryRef,
               supplier_ref AS supplierRef, default_cost_cents AS defaultCostCents,
               default_price_cents AS defaultPriceCents, source_updated_at AS sourceUpdatedAt
        FROM commerce_products p WHERE p.organization_id = ? AND p.archived = 0${approvedProduct}${productScope}
        ORDER BY name COLLATE NOCASE LIMIT 100
      `).bind(context.organizationId, ...bindScope).all(),
      database.prepare(`
        SELECT provider, external_customer_id AS externalCustomerId, display_name AS displayName,
               first_name AS firstName, last_name AS lastName, email, phone,
               source_updated_at AS sourceUpdatedAt
        FROM commerce_customers c WHERE c.organization_id = ? AND c.archived = 0${approvedCustomer}${customerScope}
        ORDER BY display_name COLLATE NOCASE LIMIT 100
      `).bind(context.organizationId, ...bindScope).all(),
      database.prepare(`
        SELECT provider, external_supplier_id AS externalSupplierId, name, account_number AS accountNumber,
               contact_name AS contactName, email, phone, source_updated_at AS sourceUpdatedAt
        FROM commerce_suppliers s WHERE s.organization_id = ? AND s.archived = 0${approvedSupplier}${supplierScope}
        ORDER BY name COLLATE NOCASE LIMIT 100
      `).bind(context.organizationId, ...bindScope).all(),
      database.prepare(`
        SELECT provider, coalesce(product_ref, sku, product_name, 'Unclassified') AS productRef,
               coalesce(max(product_name), max(sku), 'Unclassified') AS name,
               sum(quantity_milli) AS quantityMilli, sum(net_sales_cents) AS netSalesCents,
               sum(net_sales_cents - cost_cents) AS grossProfitCents
        FROM commerce_sale_lines l WHERE l.organization_id = ?${approvedSale}${saleScope}
        GROUP BY provider, coalesce(product_ref, sku, product_name, 'Unclassified')
        ORDER BY netSalesCents DESC LIMIT 20
      `).bind(context.organizationId, ...bindScope).all(),
    ]);
    const sourceMap = new Map<string, { provider: string; products: number; customers: number; suppliers: number; saleLines: number }>();
    const mergeSource = (provider: string, key: "products" | "customers" | "suppliers" | "saleLines", value: number) => {
      const current = sourceMap.get(provider) ?? { provider, products: 0, customers: 0, suppliers: 0, saleLines: 0 };
      current[key] = Number(value);
      sourceMap.set(provider, current);
    };
    for (const row of productSources.results ?? []) mergeSource(row.provider, "products", row.value);
    for (const row of customerSources.results ?? []) mergeSource(row.provider, "customers", row.value);
    for (const row of supplierSources.results ?? []) mergeSource(row.provider, "suppliers", row.value);
    for (const row of saleSources.results ?? []) mergeSource(row.provider, "saleLines", row.value);
    const sources = [...sourceMap.values()].sort((left, right) => left.provider.localeCompare(right.provider));
    const counts = {
      products: Number(productCount?.value ?? 0),
      customers: Number(customerCount?.value ?? 0),
      suppliers: Number(supplierCount?.value ?? 0),
      saleLines: Number(saleCount?.value ?? 0),
    };
    const safeProducts = canReadInventory ? (products.results ?? []).map((row) => ({
      ...row,
      supplierRef: canReadSuppliers ? row.supplierRef : null,
      defaultCostCents: canReadProductCosts ? row.defaultCostCents : null,
    })) : [];
    const safeCustomers = canReadCustomerTotals ? (customers.results ?? []).map((row) => canReadCustomerIdentity
      ? row
      : { ...row, externalCustomerId: null, displayName: null, firstName: null, lastName: null, email: null, phone: null }) : [];
    const safeTopProducts = (topProducts.results ?? []).map((row) => ({
      ...row,
      grossProfitCents: canViewVerifiedProfit ? row.grossProfitCents : null,
    }));
    return jsonResponse({
      source: "normalized-commerce",
      sources,
      counts,
      products: safeProducts,
      customers: safeCustomers,
      suppliers: canReadSuppliers ? suppliers.results ?? [] : [],
      topProducts: safeTopProducts,
      customerIdentityAvailable: canReadCustomerIdentity,
      productCostsAvailable: canReadProductCosts,
      profitAvailable: canViewVerifiedProfit,
      profitAvailability: canViewVerifiedProfit ? "verified" : squareCostGap ? "Square does not supply verified product cost in this connection; profit and margin are withheld." : "permission_required",
      supplierDetailsAvailable: canReadSuppliers,
      locationScope: locationRestricted ? {
        id: selectedLocation?.id ?? "accessible",
        name: selectedLocation?.name ?? "Accessible locations",
        mappedProviders: [...new Set(providerLocations.map((mapping) => mapping.provider))],
      } : null,
      scopeBoundary: locationRestricted
        ? blockedScope
          ? "No provider location is mapped to this organization location, so location-specific commerce records remain unavailable."
          : "Products, customers and suppliers are included only when a normalized sale at the selected mapped location supports the relationship."
        : "All approved normalized commerce sources in this organization are included.",
    });
  });
}
