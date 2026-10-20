import { businessTimestampRange } from "../domain/business-period";
import { businessClock } from "../domain/intraday-sales";
import { getD1 } from "../db";
import { clientSource, hashIdentifier } from "./api";

export const OWNER_COST_HISTORY_ACTION = "inventory.cost_effective";

type CostProduct = { id: string; provider: string; externalProductId: string; sku: string;
  ownerCostCents: number; ownerCostUpdatedAt: number | null };
type CostVersion = { unitCostCents: number; effectiveAtMs: number; effectiveLocal: string };

/** Historical releases wrote seconds through Drizzle and milliseconds through SQL. */
export function ownerCostInstant(value: number | null): number | null {
  if (value === null || !Number.isSafeInteger(value) || value < 0) return null;
  return value < 100_000_000_000 ? value * 1000 : value;
}

function localTimestamp(value: number, timezone: string) {
  const clock = businessClock(new Date(value), timezone);
  if (!clock) throw new Error("Invalid owner cost effective instant");
  const h = String(Math.floor(clock.second / 3600)).padStart(2, "0");
  const m = String(Math.floor(clock.second % 3600 / 60)).padStart(2, "0");
  const s = String(clock.second % 60).padStart(2, "0");
  return `${clock.date}T${h}:${m}:${s}.${String(value % 1000).padStart(3, "0")}`;
}

const costSaleTimestamp = `(CASE WHEN line.provider IN ('lightspeed-r','lightspeed') THEN (SELECT
  CASE WHEN parent.state='completed' THEN parent.sold_at END FROM integration_staged_sales parent
  WHERE parent.organization_id=line.organization_id AND parent.provider=line.provider
    AND parent.connection_id=line.connection_id AND parent.external_sale_id=line.external_sale_id
  ORDER BY CASE WHEN parent.provider='lightspeed' THEN CAST(parent.external_version AS INTEGER) ELSE 0 END DESC,
    parent.staged_at DESC,parent.id DESC LIMIT 1) ELSE line.sold_at END)`;

/** Both statements belong to the same atomic D1 batch. History is append-only. */
export async function prepareOwnerCostChange(database: D1Database, input: {
  request: Request; requestId: string; organizationId: string; userId: string; productId: string;
  unitCostCents: number; source: "manual" | "csv"; now: number;
}) {
  const normalizedPrevious = `(CASE WHEN owner_cost_updated_at < 100000000000
    THEN owner_cost_updated_at * 1000 ELSE owner_cost_updated_at END)`;
  const nextInstant = `MAX(?, COALESCE(${normalizedPrevious}, -1) + 1)`;
  const eligible = `id = ? AND organization_id = ? AND archived = 0 AND EXISTS (
    SELECT 1 FROM integration_connections connection WHERE connection.id = commerce_products.connection_id
      AND connection.organization_id = commerce_products.organization_id AND connection.status = 'connected'
      AND connection.data_promotion_status = 'approved')`;
  const audit = database.prepare(`INSERT INTO audit_events
    (id,organization_id,actor_user_id,action,resource_type,resource_id,outcome,request_id,source_hash,details_json,created_at)
    SELECT ?,?,?,?,'inventory_product_cost',?,
      CASE WHEN EXISTS (SELECT 1 FROM commerce_products WHERE ${eligible}) THEN 'success' ELSE 'invalid' END,
      ?,?,COALESCE((SELECT json_object('version',1,'unitCostCents',?,'effectiveAtMs',${nextInstant},
        'previousUnitCostCents',owner_cost_cents,'previousEffectiveAtMs',${normalizedPrevious},
        'source',?,'provider',provider,'connectionId',connection_id)
        FROM commerce_products WHERE id = ? AND organization_id = ?), '{}'),?`)
    .bind(crypto.randomUUID(), input.organizationId, input.userId, OWNER_COST_HISTORY_ACTION, input.productId,
      input.productId, input.organizationId, input.requestId, await hashIdentifier(clientSource(input.request)),
      input.unitCostCents, input.now, input.source, input.productId, input.organizationId, Math.floor(input.now / 1000));
  const update = database.prepare(`UPDATE commerce_products SET owner_cost_cents = ?, owner_cost_source = ?,
    owner_cost_updated_by_user_id = ?, owner_cost_updated_at = ${nextInstant} WHERE ${eligible}`)
    .bind(input.unitCostCents, input.source, input.userId, input.now, input.productId, input.organizationId);
  return [audit, update];
}

/** Re-apply the cost that was effective when each sale occurred, never today's latest price. */
export async function applyOwnerInventoryCosts(organizationId: string, connectionId: string, updatedAt: number,
  options: { publishDailyMetrics?: boolean } = {}) {
  const database = getD1();
  const products = await database.prepare(`SELECT id,provider,external_product_id externalProductId,sku,
    owner_cost_cents ownerCostCents,owner_cost_updated_at ownerCostUpdatedAt FROM commerce_products
    WHERE organization_id = ? AND connection_id = ? AND owner_cost_cents IS NOT NULL`)
    .bind(organizationId, connectionId).all<CostProduct>();
  const changedProducts = products.results ?? [];
  if (changedProducts.length) {
    const workspace = await database.prepare("SELECT timezone FROM workspaces WHERE id = ?").bind(organizationId).first<{timezone:string}>();
    if (!workspace?.timezone) throw new Error("Business timezone is required to rebuild daily costs");
    // Materialize this small owner history once. The existing workspace audit index bounds the read;
    // there is no correlated audit scan for every historical sale.
    const history = await database.prepare(`SELECT event.resource_id productId,event.details_json details
      FROM audit_events event WHERE event.organization_id = ? AND event.action = ?
        AND event.resource_type = 'inventory_product_cost' AND event.outcome = 'success'
        AND EXISTS (SELECT 1 FROM commerce_products product WHERE product.id=event.resource_id
          AND product.organization_id=event.organization_id AND product.connection_id=?)
      ORDER BY event.created_at,event.id`).bind(organizationId, OWNER_COST_HISTORY_ACTION, connectionId)
      .all<{productId:string;details:string}>();
    const schedules = new Map<string, CostVersion[]>();
    const previousVersions = new Map<string, CostVersion[]>();
    const version = (cost: unknown, instant: unknown): CostVersion | null => typeof cost === "number" && Number.isSafeInteger(cost) && cost >= 0
      && typeof instant === "number" && Number.isSafeInteger(instant) && instant >= 0
      ? { unitCostCents: cost, effectiveAtMs: instant, effectiveLocal: localTimestamp(instant, workspace.timezone) } : null;
    for (const row of history.results ?? []) {
      let value: Record<string, unknown>;
      try { value = JSON.parse(row.details); } catch { throw new Error("Owner cost history requires review"); }
      if (value.version !== 1 || value.connectionId !== connectionId) throw new Error("Owner cost history requires review");
      const current = version(value.unitCostCents, value.effectiveAtMs);
      if (!current) throw new Error("Owner cost history requires review");
      schedules.set(row.productId, [...schedules.get(row.productId) ?? [], current]);
      const previous = version(value.previousUnitCostCents, value.previousEffectiveAtMs);
      if (previous) previousVersions.set(row.productId, [...previousVersions.get(row.productId) ?? [], previous]);
    }
    for (const product of changedProducts) {
      const schedule = schedules.get(product.id) ?? [];
      if (schedule.length) {
        const earliest = Math.min(...schedule.map(row => row.effectiveAtMs));
        schedule.push(...(previousVersions.get(product.id) ?? []).filter(row => row.effectiveAtMs < earliest));
      } else {
        const legacy = version(product.ownerCostCents, ownerCostInstant(product.ownerCostUpdatedAt));
        if (legacy) schedule.push(legacy);
      }
      if (!schedule.length) continue; // Legacy undated costs cannot prove earlier margins.
      // R-Series line creation time may precede the completed parent receipt.
      const soldAt = costSaleTimestamp;
      const pick = `(SELECT json_extract(value,'$.unitCostCents') FROM json_each(?)
        WHERE CASE WHEN substr(line.owner_cost_sold_at,-1) IN ('Z','z') OR substr(line.owner_cost_sold_at,-6,1) IN ('+','-') OR substr(line.owner_cost_sold_at,-5,1) IN ('+','-')
          THEN CAST(ROUND((julianday(line.owner_cost_sold_at)-2440587.5)*86400000) AS INTEGER) >= json_extract(value,'$.effectiveAtMs')
          ELSE strftime('%Y-%m-%dT%H:%M:%f',line.owner_cost_sold_at) >= json_extract(value,'$.effectiveLocal') END
        ORDER BY json_extract(value,'$.effectiveAtMs') DESC LIMIT 1)`;
      const cost = `CAST(ROUND(${pick} * line.quantity_milli / 1000.0) AS INTEGER)`;
      // SKU fallback is allowed only when exactly one product exists in this source namespace.
      const serialized = JSON.stringify(schedule);
      await database.prepare(`WITH source_lines AS MATERIALIZED (
        SELECT line.id,line.quantity_milli,${soldAt} owner_cost_sold_at FROM commerce_sale_lines line INDEXED BY commerce_sale_lines_product_date_idx
          WHERE line.organization_id=? AND line.provider=? AND line.connection_id=? AND line.product_ref=?
        UNION ALL SELECT line.id,line.quantity_milli,${soldAt} owner_cost_sold_at FROM commerce_sale_lines line INDEXED BY commerce_sale_lines_product_date_idx
          WHERE line.organization_id=? AND line.provider=? AND line.connection_id=? AND line.product_ref IS NULL AND line.sku=?
            AND (SELECT COUNT(*) FROM commerce_products candidate WHERE candidate.organization_id=line.organization_id
              AND candidate.provider=line.provider AND candidate.connection_id=line.connection_id AND candidate.sku=line.sku)=1),
        priced_lines AS MATERIALIZED (SELECT line.id,${cost} cost FROM source_lines line WHERE ${pick} IS NOT NULL)
        UPDATE commerce_sale_lines AS line SET cost_cents=priced.cost,cost_known=1,updated_at=? FROM priced_lines priced
          WHERE line.id=priced.id AND (line.cost_known=0 OR line.cost_cents<>priced.cost)`)
        .bind(organizationId,product.provider,connectionId,product.externalProductId,
          organizationId,product.provider,connectionId,product.sku,serialized,serialized,updatedAt).run();
    }
    await database.prepare(`UPDATE integration_staged_sales AS sale SET cost_cents=(SELECT SUM(line.cost_cents)
      FROM commerce_sale_lines line WHERE line.organization_id=sale.organization_id AND line.provider=sale.provider
        AND line.connection_id=sale.connection_id AND line.external_sale_id=sale.external_sale_id)
      WHERE sale.organization_id=? AND sale.connection_id=? AND EXISTS (SELECT 1 FROM commerce_sale_lines line
        WHERE line.organization_id=sale.organization_id AND line.provider=sale.provider AND line.connection_id=sale.connection_id
          AND line.external_sale_id=sale.external_sale_id AND line.updated_at=?)`).bind(organizationId,connectionId,updatedAt).run();
    if (options.publishDailyMetrics !== false) {
      const dates = await database.prepare(`SELECT DISTINCT business_date businessDate FROM daily_business_metrics
        WHERE organization_id=? AND source_connection_id=?`).bind(organizationId,connectionId).all<{businessDate:string}>();
      const location = `(metric.location_ref=line.provider||':'||line.outlet_ref OR metric.location_ref=line.outlet_ref)`;
      const statements = (dates.results ?? []).map(row => {
        const window = businessTimestampRange("line.owner_cost_sold_at", row.businessDate, row.businessDate, workspace.timezone);
        return database.prepare(`WITH report_lines AS MATERIALIZED (SELECT line.*,${costSaleTimestamp} owner_cost_sold_at
          FROM commerce_sale_lines line WHERE line.organization_id=? AND line.connection_id=?)
          UPDATE daily_business_metrics AS metric SET cost_of_goods_cents=(SELECT SUM(line.cost_cents)
          FROM report_lines line WHERE line.organization_id=metric.organization_id AND line.connection_id=metric.source_connection_id
            AND ${window.sql} AND ${location}),updated_at=?
          WHERE metric.organization_id=? AND metric.source_connection_id=? AND metric.business_date=? AND EXISTS (
            SELECT 1 FROM report_lines line WHERE line.organization_id=metric.organization_id AND line.connection_id=metric.source_connection_id
              AND ${window.sql} AND ${location} AND line.updated_at=?)`)
          .bind(organizationId,connectionId,...window.bindings,updatedAt,organizationId,connectionId,row.businessDate,...window.bindings,updatedAt);
      });
      for (let index=0;index<statements.length;index+=50) await database.batch(statements.slice(index,index+50));
    }
  }
  // Known nonzero provider amounts remain evidence. An explicit zero needs cost_known;
  // a current catalog price is never evidence that an earlier zero was complete.
  const remaining = await database.prepare(`SELECT COUNT(*) AS count FROM commerce_sale_lines line
    WHERE line.organization_id=? AND line.connection_id=? AND line.quantity_milli<>0
      AND line.cost_cents=0 AND line.cost_known=0`).bind(organizationId,connectionId).first<{count:number}>();
  return { missingCostLines: Number(remaining?.count ?? 0) };
}
