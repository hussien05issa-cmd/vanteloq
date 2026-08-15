import { getD1 } from "../db";

/**
 * Re-applies owner-managed product costs after a connector refresh and then
 * rebuilds daily COGS from the normalized sale-line ledger. Provider refreshes
 * may update their own cost fields, but cannot erase an owner's explicit cost.
 */
export async function applyOwnerInventoryCosts(organizationId: string, connectionId: string, updatedAt: number) {
  const database = getD1();
  await database.prepare(`
    UPDATE commerce_sale_lines AS line
    SET cost_cents = COALESCE((
      SELECT CAST(ROUND(product.owner_cost_cents * line.quantity_milli / 1000.0) AS INTEGER)
      FROM commerce_products product
      WHERE product.organization_id = line.organization_id
        AND product.provider = line.provider
        AND product.connection_id = line.connection_id
        AND product.archived = 0
        AND product.owner_cost_cents IS NOT NULL
        AND (
          product.external_product_id = line.product_ref
          OR (line.product_ref IS NULL AND product.sku = line.sku)
        )
      ORDER BY CASE WHEN product.external_product_id = line.product_ref THEN 0 ELSE 1 END
      LIMIT 1
    ), line.cost_cents), updated_at = ?
    WHERE line.organization_id = ? AND line.connection_id = ?
      AND EXISTS (
        SELECT 1 FROM commerce_products product
        WHERE product.organization_id = line.organization_id
          AND product.provider = line.provider
          AND product.connection_id = line.connection_id
          AND product.archived = 0
          AND product.owner_cost_cents IS NOT NULL
          AND (
            product.external_product_id = line.product_ref
            OR (line.product_ref IS NULL AND product.sku = line.sku)
          )
      )
  `).bind(updatedAt, organizationId, connectionId).run();

  await database.prepare(`
    UPDATE integration_staged_sales AS sale
    SET cost_cents = COALESCE((
      SELECT SUM(line.cost_cents) FROM commerce_sale_lines line
      WHERE line.organization_id = sale.organization_id
        AND line.provider = sale.provider
        AND line.connection_id = sale.connection_id
        AND line.external_sale_id = sale.external_sale_id
    ), sale.cost_cents)
    WHERE sale.organization_id = ? AND sale.connection_id = ?
  `).bind(organizationId, connectionId).run();

  await database.prepare(`
    UPDATE daily_business_metrics AS metric
    SET cost_of_goods_cents = COALESCE((
          SELECT SUM(line.cost_cents) FROM commerce_sale_lines line
          WHERE line.organization_id = metric.organization_id
            AND line.connection_id = metric.source_connection_id
            AND substr(line.sold_at, 1, 10) = metric.business_date
            AND (metric.location_ref = line.provider || ':' || line.outlet_ref OR metric.location_ref = line.outlet_ref)
        ), 0), updated_at = ?
    WHERE metric.organization_id = ? AND metric.source_connection_id = ?
  `).bind(updatedAt, organizationId, connectionId).run();

  const remaining = await database.prepare(`
    SELECT COUNT(*) AS count
    FROM commerce_sale_lines line
    LEFT JOIN commerce_products product
      ON product.organization_id = line.organization_id
     AND product.provider = line.provider
     AND product.connection_id = line.connection_id
     AND (
       product.external_product_id = line.product_ref
       OR (line.product_ref IS NULL AND product.sku = line.sku)
     )
    WHERE line.organization_id = ? AND line.connection_id = ?
      AND line.net_sales_cents <> 0 AND line.quantity_milli <> 0
      AND line.cost_cents = 0
      AND product.owner_cost_cents IS NULL
      AND product.default_cost_cents IS NULL
  `).bind(organizationId, connectionId).first<{ count: number }>();
  return { missingCostLines: Number(remaining?.count ?? 0) };
}
