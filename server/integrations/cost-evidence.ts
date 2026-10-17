import { getD1 } from "../../db";
import { businessTimestampRange } from "../../domain/business-period";
import { businessDateForTimestamp } from "../../domain/intraday-sales";

/** Source identifiers are fixed application aliases, never user query text. */
export function stagedSaleCostVerifiedSql(alias: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid staged sale alias");
  const scope = `cost_line.organization_id=${alias}.organization_id AND cost_line.provider=${alias}.provider
    AND cost_line.connection_id=${alias}.connection_id AND cost_line.external_sale_id=${alias}.external_sale_id`;
  return `CASE WHEN ${alias}.total_cents=${alias}.tax_cents AND ${alias}.cost_cents=0 THEN 1
    WHEN EXISTS (SELECT 1 FROM commerce_sale_lines cost_line WHERE ${scope})
      AND NOT EXISTS (SELECT 1 FROM commerce_sale_lines cost_line WHERE ${scope}
        AND cost_line.quantity_milli<>0 AND cost_line.cost_known=0 AND cost_line.cost_cents=0)
      AND (SELECT SUM(cost_line.cost_cents) FROM commerce_sale_lines cost_line WHERE ${scope})=${alias}.cost_cents
      AND (${alias}.line_count=0 OR (SELECT COUNT(*) FROM commerce_sale_lines cost_line WHERE ${scope})=${alias}.line_count)
    THEN 1 ELSE 0 END`;
}

type Row = { businessDate: string; sourceProvider?: string | null; sourceConnectionId?: string | null; locationRef: string };
/** Legacy R-Series staging did not retain whether a zero cost was explicitly supplied.
 * Do not turn that ambiguity into verified profit, including on returned sales. */
export async function hasAmbiguousRSeriesCosts(organizationId: string, rows: Row[], timeZone: string): Promise<boolean> {
  return (await ambiguousRSeriesCostDates(organizationId, rows, timeZone)).size > 0;
}
export async function ambiguousRSeriesCostDates(organizationId: string, rows: Row[], timeZone: string): Promise<Set<string>> {
  const missing = new Set<string>();
  const relevant = rows.filter(row => row.sourceProvider === "lightspeed-r" && row.sourceConnectionId);
  const scopes = [...new Map(relevant.map(row => [row.sourceConnectionId + ":" + row.locationRef, row])).values()];
  for (const scope of scopes) {
    const dates = relevant.filter(row => row.sourceConnectionId === scope.sourceConnectionId && row.locationRef === scope.locationRef).map(row => row.businessDate).sort();
    const window = businessTimestampRange("sold_at", dates[0], dates.at(-1)!, timeZone);
    const found = await getD1().prepare(`WITH latest AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY connection_id, external_sale_id ORDER BY staged_at DESC, id DESC) version_rank
      FROM integration_staged_sales WHERE organization_id = ? AND provider = 'lightspeed-r' AND connection_id = ?
    ) SELECT sold_at AS soldAt FROM latest WHERE version_rank = 1 AND outlet_ref = ?
      AND state = 'completed' AND (${stagedSaleCostVerifiedSql("latest")})=0 AND ${window.sql} LIMIT 20001`)
      .bind(organizationId, scope.sourceConnectionId!, scope.locationRef.replace(/^lightspeed-r:/, ""), ...window.bindings).all<{soldAt:string}>();
    if ((found.results?.length ?? 0) > 20000) { dates.forEach(date => missing.add(date)); continue; }
    for (const sale of found.results ?? []) {
      const date = businessDateForTimestamp(sale.soldAt, timeZone);
      if (date && dates.includes(date)) missing.add(date);
    }
  }
  return missing;
}
