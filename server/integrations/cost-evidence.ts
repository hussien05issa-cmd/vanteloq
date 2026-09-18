import { getD1 } from "../../db";
import { businessTimestampRange } from "../../domain/business-period";
import { businessClock } from "../../domain/intraday-sales";

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
      AND state = 'completed' AND cost_cents = 0 AND total_cents != tax_cents AND ${window.sql} LIMIT 20001`)
      .bind(organizationId, scope.sourceConnectionId!, scope.locationRef.replace(/^lightspeed-r:/, ""), ...window.bindings).all<{soldAt:string}>();
    if ((found.results?.length ?? 0) > 20000) { dates.forEach(date => missing.add(date)); continue; }
    for (const sale of found.results ?? []) {
      const date = businessClock(new Date(sale.soldAt), timeZone)?.date;
      if (date && dates.includes(date)) missing.add(date);
    }
  }
  return missing;
}
