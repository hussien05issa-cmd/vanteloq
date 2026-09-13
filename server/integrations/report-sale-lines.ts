// R-Series SaleLine pages include unfinished sales and use line creation time.
// Resolve the latest parent sale before treating a line as trading evidence.
// The derived source keeps the existing column contract for every consumer.
export const reportSaleLinesSql = `(SELECT
  c.id, c.organization_id, c.provider, c.connection_id, c.external_sale_id,
  c.external_line_id, c.product_ref, c.customer_ref,
  CASE WHEN c.provider = 'lightspeed-r' THEN s.outlet_ref ELSE c.outlet_ref END AS outlet_ref,
  CASE WHEN c.provider = 'lightspeed-r' THEN s.sold_at ELSE c.sold_at END AS sold_at,
  c.sku, c.product_name, c.quantity_milli, c.net_sales_cents, c.cost_cents,
  c.discount_cents, c.source_payload_hash, c.sync_run_id, c.updated_at
  FROM commerce_sale_lines c
  LEFT JOIN integration_staged_sales s ON c.provider = 'lightspeed-r' AND s.id = (
    SELECT parent.id FROM integration_staged_sales parent
    WHERE parent.organization_id = c.organization_id AND parent.provider = c.provider
      AND parent.connection_id = c.connection_id AND parent.external_sale_id = c.external_sale_id
    ORDER BY parent.staged_at DESC, parent.id DESC LIMIT 1
  )
  WHERE c.provider <> 'lightspeed-r' OR s.state = 'completed')`;
