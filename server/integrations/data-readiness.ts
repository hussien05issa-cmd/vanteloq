import type { CommerceFieldEvidence, CommerceFieldKey } from "../../domain/integration-data-readiness";
import type { CanonicalCommerceCoverage } from "../../domain/provider-feature-coverage";

/** Counts describe stored fields in one account, not complete provider history or a report period. */
export async function loadCommerceFieldEvidence(database: D1Database, organizationId: string, connectionId: string, permissions: readonly string[]) {
  const row = await database.prepare(`
    WITH scope AS (SELECT ? organization_id, ? connection_id),
    sales AS (SELECT COUNT(*) records, COUNT(net_sales_cents) net, COUNT(NULLIF(TRIM(business_date), '')) dated,
      MIN(NULLIF(TRIM(business_date), '')) first_date, MAX(NULLIF(TRIM(business_date), '')) last_date
      FROM daily_business_metrics, scope WHERE daily_business_metrics.organization_id = scope.organization_id AND source_connection_id = scope.connection_id),
    lines AS (SELECT COUNT(*) records, COUNT(net_sales_cents) net, COUNT(quantity_milli) quantity,
      COALESCE(SUM(CASE WHEN cost_known = 1 THEN 1 ELSE 0 END), 0) costs,
      COUNT(NULLIF(TRIM(customer_ref), '')) customers, COUNT(NULLIF(TRIM(product_ref), '')) products, COUNT(julianday(sold_at)) dated
      FROM commerce_sale_lines, scope WHERE commerce_sale_lines.organization_id = scope.organization_id AND commerce_sale_lines.connection_id = scope.connection_id),
    payments AS (SELECT COUNT(*) records, COUNT(amount_cents) amounts, COUNT(julianday(paid_at)) dated,
      COUNT(NULLIF(TRIM(external_sale_id), '')) sales, COUNT(NULLIF(NULLIF(TRIM(payment_type_name), ''), 'Other')) types
      FROM commerce_payments, scope WHERE commerce_payments.organization_id = scope.organization_id AND commerce_payments.connection_id = scope.connection_id),
    products AS (SELECT COUNT(*) records, COUNT(NULLIF(TRIM(external_product_id), '')) identities,
      COUNT(COALESCE(owner_cost_cents, default_cost_cents)) costs
      FROM commerce_products, scope WHERE commerce_products.organization_id = scope.organization_id AND commerce_products.connection_id = scope.connection_id AND archived = 0),
    inventory AS (SELECT COUNT(*) records, COUNT(on_hand_quantity) quantities,
      COALESCE(SUM(CASE WHEN updated_at > 0 AND updated_at <= unixepoch() THEN 1 ELSE 0 END), 0) dated
      FROM inventory_balances, scope WHERE inventory_balances.organization_id = scope.organization_id AND source_connection_id = scope.connection_id),
    customers AS (SELECT COUNT(*) records, COUNT(NULLIF(TRIM(external_customer_id), '')) identities
      FROM commerce_customers, scope WHERE commerce_customers.organization_id = scope.organization_id AND commerce_customers.connection_id = scope.connection_id AND archived = 0),
    suppliers AS (SELECT COUNT(*) records, COUNT(NULLIF(TRIM(external_supplier_id), '')) identities
      FROM commerce_suppliers, scope WHERE commerce_suppliers.organization_id = scope.organization_id AND commerce_suppliers.connection_id = scope.connection_id AND archived = 0),
    locations AS (SELECT COUNT(*) records,
      COALESCE(SUM(CASE WHEN status = 'mapped' AND NULLIF(TRIM(local_location_id), '') IS NOT NULL THEN 1 ELSE 0 END), 0) mapped
      FROM integration_location_mappings, scope WHERE integration_location_mappings.organization_id = scope.organization_id AND integration_location_mappings.connection_id = scope.connection_id AND status <> 'ignored')
    SELECT sales.records sales_records, sales.net sales_net, sales.dated sales_dated, sales.first_date, sales.last_date,
      lines.records line_records, lines.net line_net, lines.quantity line_quantity, lines.costs line_costs, lines.customers line_customers, lines.products line_products, lines.dated line_dated,
      payments.records payment_records, payments.amounts payment_amounts, payments.dated payment_dated, payments.sales payment_sales, payments.types payment_types,
      products.records product_records, products.identities product_identities, products.costs product_costs,
      inventory.records inventory_records, inventory.quantities inventory_quantities, inventory.dated inventory_dated,
      customers.records customer_records, customers.identities customer_identities,
      suppliers.records supplier_records, suppliers.identities supplier_identities,
      locations.records location_records, locations.mapped location_mapped
    FROM sales, lines, payments, products, inventory, customers, suppliers, locations
  `).bind(organizationId, connectionId).first<Record<string, number | string | null>>();
  // A failed query must not be recast as an empty account.
  if (!row) throw new Error("Commerce field evidence is unavailable.");
  const can = (...required: string[]) => required.every(permission => permissions.includes(permission));
  const fields: CommerceFieldEvidence = {};
  function field(key: CommerceFieldKey, total: string, populated: string, authorised: boolean) {
    fields[key] = { records: Number(row![total]), populated: Number(row![populated]), authorised };
  }
  field("sales.net", "sales_records", "sales_net", can("metrics.revenue"));
  field("sales.date", "sales_records", "sales_dated", can("metrics.revenue"));
  field("lines.net", "line_records", "line_net", can("sales.transactions", "metrics.revenue"));
  field("lines.date", "line_records", "line_dated", can("sales.transactions"));
  field("lines.quantity", "line_records", "line_quantity", can("sales.transactions"));
  field("lines.cost", "line_records", "line_costs", can("sales.transactions", "finance.costs", "metrics.profit"));
  field("lines.customer", "line_records", "line_customers", can("sales.transactions", "customers.totals"));
  field("lines.product", "line_records", "line_products", can("sales.transactions", "inventory.view"));
  field("payments.amount", "payment_records", "payment_amounts", can("sales.transactions", "metrics.revenue"));
  field("payments.date", "payment_records", "payment_dated", can("sales.transactions"));
  field("payments.sale", "payment_records", "payment_sales", can("sales.transactions"));
  field("payments.type", "payment_records", "payment_types", can("sales.transactions"));
  field("products.identity", "product_records", "product_identities", can("inventory.view"));
  field("products.cost", "product_records", "product_costs", can("inventory.view", "inventory.value", "finance.costs"));
  field("inventory.quantity", "inventory_records", "inventory_quantities", can("inventory.view"));
  field("inventory.updated", "inventory_records", "inventory_dated", can("inventory.view"));
  field("customers.identity", "customer_records", "customer_identities", can("customers.totals"));
  field("suppliers.identity", "supplier_records", "supplier_identities", can("purchasing.view"));
  field("locations.mapping", "location_records", "location_mapped", can("integrations.view"));
  const present = (key: CommerceFieldKey) => fields[key]?.authorised === true && fields[key]!.populated > 0;
  const coverage: CanonicalCommerceCoverage = { sales: present("sales.net"), payments: present("payments.amount"), products: present("products.identity"),
    inventory: present("inventory.quantity"), customers: present("customers.identity"), suppliers: present("suppliers.identity"), locations: present("locations.mapping") };
  return { fields, coverage, observedPeriod: { from: can("metrics.revenue") && typeof row.first_date === "string" ? row.first_date : null,
    to: can("metrics.revenue") && typeof row.last_date === "string" ? row.last_date : null } };
}
