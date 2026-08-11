import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { integrationLocationMappings } from "../../../../db/schema";
import { requireAccess } from "../../../../server/authorization";
import { handleApi, jsonResponse } from "../../../../server/api";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { requireAccessibleLocation } from "../../../../server/location-access";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers);
    await requirePermission(context, "dashboard.view");
    const permissions = await effectivePermissions(context);
    const canReadCustomerIdentity = permissions.includes("customers.identity");
    const database = getD1();
    const requestedLocationId = new URL(request.url).searchParams.get("location");
    const selectedLocation = requestedLocationId ? await requireAccessibleLocation(context, requestedLocationId) : null;
    const mappings = selectedLocation ? await getDb().select({
      provider: integrationLocationMappings.provider,
      externalLocationRef: integrationLocationMappings.externalLocationRef,
    }).from(integrationLocationMappings).where(and(
      eq(integrationLocationMappings.organizationId, context.organizationId),
      eq(integrationLocationMappings.localLocationId, selectedLocation.id),
      eq(integrationLocationMappings.status, "mapped"),
    )) : [];
    const outletRefs = mappings.map((mapping) => mapping.externalLocationRef);
    const outletPlaceholders = outletRefs.map(() => "?").join(", ");
    const blockedScope = Boolean(selectedLocation && !outletRefs.length);
    const productScope = selectedLocation
      ? blockedScope ? " AND 0 = 1" : ` AND EXISTS (SELECT 1 FROM commerce_sale_lines scope_line WHERE scope_line.organization_id = p.organization_id AND scope_line.provider = p.provider AND scope_line.product_ref = p.external_product_id AND scope_line.outlet_ref IN (${outletPlaceholders}))`
      : "";
    const customerScope = selectedLocation
      ? blockedScope ? " AND 0 = 1" : ` AND EXISTS (SELECT 1 FROM commerce_sale_lines scope_line WHERE scope_line.organization_id = c.organization_id AND scope_line.provider = c.provider AND scope_line.customer_ref = c.external_customer_id AND scope_line.outlet_ref IN (${outletPlaceholders}))`
      : "";
    const supplierScope = selectedLocation
      ? blockedScope ? " AND 0 = 1" : ` AND EXISTS (SELECT 1 FROM commerce_products scope_product JOIN commerce_sale_lines scope_line ON scope_line.organization_id = scope_product.organization_id AND scope_line.provider = scope_product.provider AND scope_line.product_ref = scope_product.external_product_id WHERE scope_product.organization_id = s.organization_id AND scope_product.provider = s.provider AND scope_product.supplier_ref = s.external_supplier_id AND scope_line.outlet_ref IN (${outletPlaceholders}))`
      : "";
    const saleScope = selectedLocation
      ? blockedScope ? " AND 0 = 1" : ` AND l.outlet_ref IN (${outletPlaceholders})`
      : "";
    const bindScope = selectedLocation && !blockedScope ? outletRefs : [];
    const [productCount, customerCount, supplierCount, saleCount, productSources, customerSources, supplierSources, saleSources, products, customers, suppliers, topProducts] = await Promise.all([
      database.prepare(`SELECT COUNT(*) value FROM commerce_products p WHERE p.organization_id = ? AND p.archived = 0${productScope}`).bind(context.organizationId, ...bindScope).first<{ value: number }>(),
      database.prepare(`SELECT COUNT(*) value FROM commerce_customers c WHERE c.organization_id = ? AND c.archived = 0${customerScope}`).bind(context.organizationId, ...bindScope).first<{ value: number }>(),
      database.prepare(`SELECT COUNT(*) value FROM commerce_suppliers s WHERE s.organization_id = ? AND s.archived = 0${supplierScope}`).bind(context.organizationId, ...bindScope).first<{ value: number }>(),
      database.prepare(`SELECT COUNT(*) value FROM commerce_sale_lines l WHERE l.organization_id = ?${saleScope}`).bind(context.organizationId, ...bindScope).first<{ value: number }>(),
      database.prepare(`SELECT p.provider, COUNT(*) value FROM commerce_products p WHERE p.organization_id = ? AND p.archived = 0${productScope} GROUP BY p.provider`).bind(context.organizationId, ...bindScope).all<{ provider: string; value: number }>(),
      database.prepare(`SELECT c.provider, COUNT(*) value FROM commerce_customers c WHERE c.organization_id = ? AND c.archived = 0${customerScope} GROUP BY c.provider`).bind(context.organizationId, ...bindScope).all<{ provider: string; value: number }>(),
      database.prepare(`SELECT s.provider, COUNT(*) value FROM commerce_suppliers s WHERE s.organization_id = ? AND s.archived = 0${supplierScope} GROUP BY s.provider`).bind(context.organizationId, ...bindScope).all<{ provider: string; value: number }>(),
      database.prepare(`SELECT l.provider, COUNT(*) value FROM commerce_sale_lines l WHERE l.organization_id = ?${saleScope} GROUP BY l.provider`).bind(context.organizationId, ...bindScope).all<{ provider: string; value: number }>(),
      database.prepare(`
        SELECT provider, external_product_id AS externalProductId, sku, name, category_ref AS categoryRef,
               supplier_ref AS supplierRef, default_cost_cents AS defaultCostCents,
               default_price_cents AS defaultPriceCents, source_updated_at AS sourceUpdatedAt
        FROM commerce_products p WHERE p.organization_id = ? AND p.archived = 0${productScope}
        ORDER BY name COLLATE NOCASE LIMIT 100
      `).bind(context.organizationId, ...bindScope).all(),
      database.prepare(`
        SELECT provider, external_customer_id AS externalCustomerId, display_name AS displayName,
               first_name AS firstName, last_name AS lastName, email, phone,
               source_updated_at AS sourceUpdatedAt
        FROM commerce_customers c WHERE c.organization_id = ? AND c.archived = 0${customerScope}
        ORDER BY display_name COLLATE NOCASE LIMIT 100
      `).bind(context.organizationId, ...bindScope).all(),
      database.prepare(`
        SELECT provider, external_supplier_id AS externalSupplierId, name, account_number AS accountNumber,
               contact_name AS contactName, email, phone, source_updated_at AS sourceUpdatedAt
        FROM commerce_suppliers s WHERE s.organization_id = ? AND s.archived = 0${supplierScope}
        ORDER BY name COLLATE NOCASE LIMIT 100
      `).bind(context.organizationId, ...bindScope).all(),
      database.prepare(`
        SELECT provider, coalesce(product_ref, sku, product_name, 'Unclassified') AS productRef,
               coalesce(max(product_name), max(sku), 'Unclassified') AS name,
               sum(quantity_milli) AS quantityMilli, sum(net_sales_cents) AS netSalesCents,
               sum(net_sales_cents - cost_cents) AS grossProfitCents
        FROM commerce_sale_lines l WHERE l.organization_id = ?${saleScope}
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
    const safeCustomers = (customers.results ?? []).map((row) => canReadCustomerIdentity
      ? row
      : { ...row, firstName: null, lastName: null, email: null, phone: null });
    return jsonResponse({
      source: "normalized-commerce",
      sources,
      counts,
      products: products.results ?? [],
      customers: safeCustomers,
      suppliers: suppliers.results ?? [],
      topProducts: topProducts.results ?? [],
      customerIdentityAvailable: canReadCustomerIdentity,
      locationScope: selectedLocation ? { id: selectedLocation.id, name: selectedLocation.name, mappedProviders: [...new Set(mappings.map((mapping) => mapping.provider))] } : null,
      scopeBoundary: selectedLocation
        ? blockedScope
          ? "No provider location is mapped to this organization location, so location-specific commerce records remain unavailable."
          : "Products, customers and suppliers are included only when a normalized sale at the selected mapped location supports the relationship."
        : "All approved normalized commerce sources in this organization are included.",
    });
  });
}
