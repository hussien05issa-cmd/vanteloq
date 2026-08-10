import { getD1 } from "../../../../db";
import { requireAccess } from "../../../../server/authorization";
import { handleApi, jsonResponse } from "../../../../server/api";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers);
    await requirePermission(context, "dashboard.view");
    const permissions = await effectivePermissions(context);
    const canReadCustomerIdentity = permissions.includes("customers.identity");
    const database = getD1();
    const [counts, products, customers, suppliers, topProducts] = await Promise.all([
      database.prepare(`
        SELECT
          (SELECT count(*) FROM commerce_products WHERE organization_id = ? AND archived = 0) AS products,
          (SELECT count(*) FROM commerce_customers WHERE organization_id = ? AND archived = 0) AS customers,
          (SELECT count(*) FROM commerce_suppliers WHERE organization_id = ? AND archived = 0) AS suppliers,
          (SELECT count(*) FROM commerce_sale_lines WHERE organization_id = ?) AS saleLines
      `).bind(context.organizationId, context.organizationId, context.organizationId, context.organizationId).first(),
      database.prepare(`
        SELECT external_product_id AS externalProductId, sku, name, category_ref AS categoryRef,
               supplier_ref AS supplierRef, default_cost_cents AS defaultCostCents,
               default_price_cents AS defaultPriceCents, source_updated_at AS sourceUpdatedAt
        FROM commerce_products WHERE organization_id = ? AND archived = 0
        ORDER BY name COLLATE NOCASE LIMIT 100
      `).bind(context.organizationId).all(),
      database.prepare(`
        SELECT external_customer_id AS externalCustomerId, display_name AS displayName,
               first_name AS firstName, last_name AS lastName, email, phone,
               source_updated_at AS sourceUpdatedAt
        FROM commerce_customers WHERE organization_id = ? AND archived = 0
        ORDER BY display_name COLLATE NOCASE LIMIT 100
      `).bind(context.organizationId).all(),
      database.prepare(`
        SELECT external_supplier_id AS externalSupplierId, name, account_number AS accountNumber,
               contact_name AS contactName, email, phone, source_updated_at AS sourceUpdatedAt
        FROM commerce_suppliers WHERE organization_id = ? AND archived = 0
        ORDER BY name COLLATE NOCASE LIMIT 100
      `).bind(context.organizationId).all(),
      database.prepare(`
        SELECT coalesce(product_ref, sku, product_name, 'Unclassified') AS productRef,
               coalesce(max(product_name), max(sku), 'Unclassified') AS name,
               sum(quantity_milli) AS quantityMilli, sum(net_sales_cents) AS netSalesCents,
               sum(net_sales_cents - cost_cents) AS grossProfitCents
        FROM commerce_sale_lines WHERE organization_id = ?
        GROUP BY coalesce(product_ref, sku, product_name, 'Unclassified')
        ORDER BY netSalesCents DESC LIMIT 20
      `).bind(context.organizationId).all(),
    ]);
    const safeCustomers = (customers.results ?? []).map((row) => canReadCustomerIdentity
      ? row
      : { ...row, firstName: null, lastName: null, email: null, phone: null });
    return jsonResponse({
      source: "lightspeed-r",
      counts: counts ?? { products: 0, customers: 0, suppliers: 0, saleLines: 0 },
      products: products.results ?? [],
      customers: safeCustomers,
      suppliers: suppliers.results ?? [],
      topProducts: topProducts.results ?? [],
      customerIdentityAvailable: canReadCustomerIdentity,
    });
  });
}
