import { ApiError, hashIdentifier } from "./api";
import type { dailyMetricImportInput } from "./validation";

type ImportInput = ReturnType<typeof dailyMetricImportInput>;
type ImportRow = ImportInput["rows"][number];
type SqlValue = string | number | null;
type StoredRow = Record<string, SqlValue>;
type ExistingImport = { id: string; status: string; rowCount: number; importedByUserId: string };

// Full financial/source snapshot, not just a timestamp that can share a millisecond.
const snapshotColumns = ["id", "business_date", "location_ref", "gross_sales_cents", "net_sales_cents", "cost_of_goods_cents", "transaction_count", "units_sold", "refunds_cents", "discounts_cents", "labour_cost_cents", "labour_cost_reported", "inventory_value_cents", "cash_balance_cents", "accounts_payable_cents", "source_provider", "source_connection_id", "source_import_id", "created_by_user_id", "created_at", "updated_at"] as const;
const metricColumns = ["gross_sales_cents", "net_sales_cents", "cost_of_goods_cents", "transaction_count", "units_sold", "refunds_cents", "discounts_cents", "labour_cost_cents", "labour_cost_reported", "inventory_value_cents", "cash_balance_cents", "accounts_payable_cents"] as const;
const metricKeys = ["grossSalesCents", "netSalesCents", "costOfGoodsCents", "transactionCount", "unitsSold", "refundsCents", "discountsCents", "labourCostCents", "labourCostReported", "inventoryValueCents", "cashBalanceCents", "accountsPayableCents"] as const;
const keyFor = (date: string, location: string) => JSON.stringify([date, location]);
const storedSnapshot = (row: StoredRow | undefined) => row ? snapshotColumns.map((column) => row[column] ?? null) : null;
const metricValues = (row: ImportRow): SqlValue[] => metricKeys.map((key) => key === "labourCostReported" ? (row.labourCostReported ? 1 : 0) : row[key]) as SqlValue[];
// A local location ID or its current name must not bypass its mapped POS source.
// Match the same namespace format used by scopeExternalRef in location-access.ts.
const mappedOverlap = (source: string, targetRef: string) => `EXISTS (
  SELECT 1 FROM integration_location_mappings mapping
  LEFT JOIN integration_connections connection ON connection.id=mapping.connection_id AND connection.organization_id=mapping.organization_id
  LEFT JOIN organization_locations local ON local.id=mapping.local_location_id AND local.organization_id=mapping.organization_id
  WHERE mapping.organization_id=${source}.organization_id AND mapping.status='mapped'
    AND (mapping.local_location_id=${targetRef} OR local.name=${targetRef})
    AND ${source}.location_ref=mapping.provider || ':' || CASE WHEN connection.source_namespace IS NULL OR connection.source_namespace='legacy'
      THEN mapping.external_location_ref ELSE connection.source_namespace || ':' || mapping.external_location_ref END
    AND (${source}.source_provider IS NOT NULL OR ${source}.source_connection_id IS NOT NULL))`;

export type DailyImportReview = {
  snapshot: string;
  rows: Array<{ businessDate: string; locationRef: string; before: Record<string, SqlValue>; after: Record<string, SqlValue> }>;
  newRows: number;
};

export async function dailyImportIdentity(organizationId: string, idempotencyKey: string, input: ImportInput) {
  const rows = [...input.rows].sort((a, b) => {
    const left = keyFor(a.businessDate, a.locationRef), right = keyFor(b.businessDate, b.locationRef);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const payload = { version: 2, importType: input.importType, fileName: input.fileName, rows, replacement: input.replacement ?? null };
  const payloadHash = await hashIdentifier(JSON.stringify(payload));
  // Existing schema already stores the immutable ID. Versioned IDs bind a key to
  // its payload without adding a nullable hash column that legacy rows could bypass.
  const id = `import-v2-${(await hashIdentifier(JSON.stringify([organizationId, idempotencyKey, payloadHash]))).slice(0, 40)}`;
  return { id, payloadHash, rows };
}

function replay(existing: ExistingImport | null, expectedId: string, actorUserId: string) {
  if (!existing) return null;
  if (existing.id !== expectedId || existing.importedByUserId !== actorUserId) {
    throw new ApiError(409, "IDEMPOTENCY_KEY_CONFLICT", "This request key belongs to different import data or an older unverifiable request. Start a new import and review its changes.");
  }
  if (existing.status !== "completed") {
    throw new ApiError(409, "IMPORT_IN_PROGRESS", "This import has not completed. Check its status before starting another request.");
  }
  return { kind: "saved" as const, import: { id: existing.id, status: "completed", rowCount: existing.rowCount }, replayed: true };
}

export async function saveDailyMetricImport(database: D1Database, context: {
  organizationId: string; actorUserId: string; requestId: string; sourceHash: string;
}, idempotencyKey: string, input: ImportInput) {
  const { id, payloadHash, rows } = await dailyImportIdentity(context.organizationId, idempotencyKey, input);
  const findImport = () => database.prepare(`SELECT id, status, row_count rowCount, imported_by_user_id importedByUserId
    FROM data_imports WHERE organization_id=? AND idempotency_key=? LIMIT 1`)
    .bind(context.organizationId, idempotencyKey).first<ExistingImport>();
  const repeated = replay(await findImport(), id, context.actorUserId);
  if (repeated) return repeated;

  if (rows.some((row) => /^(?:lightspeed(?:-r)?|shopify(?:-pos)?|square|clover|moneris|stripe):/i.test(row.locationRef))) {
    throw new ApiError(409, "IMPORT_PROVIDER_SOURCE_PROTECTED", "Connector location references are reserved for POS imports. Correct connected records in their provider, then sync again.");
  }
  const targets = JSON.stringify(rows.map((row) => [row.businessDate, row.locationRef]));
  const sourceRows = (await database.prepare(`SELECT DISTINCT m.*, json_extract(target.value,'$[1]') import_target_ref FROM daily_business_metrics m
    JOIN json_each(?) target ON m.business_date=json_extract(target.value,'$[0]')
      AND (m.location_ref=json_extract(target.value,'$[1]') OR m.location_ref='all' OR json_extract(target.value,'$[1]')='all'
        OR ${mappedOverlap("m", "json_extract(target.value,'$[1]')")})
    WHERE m.organization_id=?`).bind(targets, context.organizationId).all<StoredRow>()).results ?? [];
  const current = new Map(sourceRows.map((row) => [keyFor(String(row.business_date), String(row.location_ref)), row]));
  for (const row of rows) {
    const overlapping = sourceRows.filter((stored) => stored.business_date === row.businessDate && stored.import_target_ref === row.locationRef);
    if (overlapping.some((stored) => stored.source_provider != null || stored.source_connection_id != null)) {
      throw new ApiError(409, "IMPORT_PROVIDER_SOURCE_PROTECTED", `Connected POS records already cover ${row.businessDate} at ${row.locationRef}. Correct those records in the POS provider and sync again; this import has not changed them.`);
    }
    if (overlapping.some((stored) => stored.location_ref !== row.locationRef)) {
      throw new ApiError(409, "IMPORT_LOCATION_SCOPE_CONFLICT", "An all-location summary overlaps location-specific records. Use one consistent reporting scope; no records were changed.");
    }
  }
  const basePayload = { version: 1, organizationId: context.organizationId, actorUserId: context.actorUserId,
    importType: input.importType, fileName: input.fileName, rows,
    previous: rows.map((row) => storedSnapshot(current.get(keyFor(row.businessDate, row.locationRef)))) };
  const snapshot = await hashIdentifier(JSON.stringify(basePayload));
  const reviewedRows = rows.filter((row) => current.has(keyFor(row.businessDate, row.locationRef)));
  const review: DailyImportReview = {
    snapshot, newRows: rows.length - reviewedRows.length,
    rows: reviewedRows.map((row) => {
      const stored = current.get(keyFor(row.businessDate, row.locationRef))!;
      return { businessDate: row.businessDate, locationRef: row.locationRef,
        before: Object.fromEntries(metricKeys.map((name, index) => [name, stored[metricColumns[index]] ?? null])),
        after: Object.fromEntries(metricKeys.map((name, index) => [name, metricValues(row)[index]])) };
    }),
  };
  if (input.replacement && input.replacement.snapshot !== snapshot) {
    return { kind: "review" as const, code: "IMPORT_REVIEW_STALE", message: "The records changed after your review. Review the current values before replacing them.", review };
  }
  if (reviewedRows.length && !input.replacement) {
    return { kind: "review" as const, code: "IMPORT_REVIEW_REQUIRED", message: "Review the existing daily records before replacing them.", review };
  }

  const now = Math.floor(Date.now() / 1000);
  const statements: D1PreparedStatement[] = [database.prepare(`INSERT INTO data_imports
    (id, organization_id, import_type, status, file_name, row_count, idempotency_key, imported_by_user_id, created_at)
    VALUES (?, ?, ?, 'processing', ?, 0, ?, ?, ?)`).bind(id, context.organizationId, input.importType, input.fileName, idempotencyKey, context.actorUserId, now)];
  const audit = (action: string, details: Record<string, string | number | boolean | null>) => {
    const serialized = JSON.stringify(details);
    if (serialized.length > 2000) throw new ApiError(400, "IMPORT_REVIEW_TOO_LARGE", "The correction note is too long to store safely.");
    return database.prepare(`INSERT INTO audit_events
      (id, organization_id, actor_user_id, action, resource_type, resource_id, outcome, request_id, source_hash, details_json, created_at)
      VALUES (?, ?, ?, ?, 'data_import', ?, 'success', ?, ?, ?, ?)`).bind(crypto.randomUUID(), context.organizationId, context.actorUserId, action, id, context.requestId, context.sourceHash, serialized, now);
  };
  for (const row of rows) {
    const before = current.get(keyFor(row.businessDate, row.locationRef));
    const snapshotCondition = before
      ? `EXISTS (SELECT 1 FROM daily_business_metrics original WHERE original.organization_id=? AND ${snapshotColumns.map((column) => `original.${column} IS ?`).join(" AND ")})`
      : "NOT EXISTS (SELECT 1 FROM daily_business_metrics original WHERE original.organization_id=? AND original.business_date=? AND original.location_ref=?)";
    const snapshotBindings = before ? [context.organizationId, ...storedSnapshot(before)!] : [context.organizationId, row.businessDate, row.locationRef];
    const overlapCondition = row.locationRef === "all"
      ? "NOT EXISTS (SELECT 1 FROM daily_business_metrics scope WHERE scope.organization_id=? AND scope.business_date=? AND scope.location_ref<>'all')"
      : "NOT EXISTS (SELECT 1 FROM daily_business_metrics scope WHERE scope.organization_id=? AND scope.business_date=? AND scope.location_ref='all')";
    const mappedCondition = `NOT EXISTS (SELECT 1 FROM daily_business_metrics mapped WHERE mapped.organization_id=?
      AND mapped.business_date=? AND ${mappedOverlap("mapped", "?")})`;
    // A failed snapshot deliberately violates the existing nonnegative-gross check.
    // D1 rolls back the entire batch, including the request claim and earlier rows.
    statements.push(database.prepare(`INSERT INTO daily_business_metrics (
      organization_id, business_date, location_ref, ${metricColumns.join(", ")},
      source_provider, source_connection_id, source_import_id, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, CASE WHEN (${snapshotCondition}) AND (${overlapCondition}) AND (${mappedCondition}) THEN ? ELSE -1 END,
        ${metricColumns.slice(1).map(() => "?").join(", ")}, NULL, NULL, ?, ?, ?, ?)
      ON CONFLICT(organization_id, business_date, location_ref) DO UPDATE SET
        ${metricColumns.map((column) => `${column}=excluded.${column}`).join(", ")},
        source_import_id=excluded.source_import_id, updated_at=excluded.updated_at
      WHERE daily_business_metrics.source_provider IS NULL AND daily_business_metrics.source_connection_id IS NULL`)
      .bind(context.organizationId, row.businessDate, row.locationRef, ...snapshotBindings,
        context.organizationId, row.businessDate, context.organizationId, row.businessDate, row.locationRef, row.locationRef,
        ...metricValues(row), id, context.actorUserId, now, now));
    if (before) statements.push(audit("daily_metrics.replaced", {
      businessDate: row.businessDate, locationRef: row.locationRef, reason: input.replacement!.reason,
      reviewSnapshot: snapshot, previousImportId: String(before.source_import_id ?? ""),
      previousValues: JSON.stringify(metricColumns.map((column) => before[column] ?? null)),
      replacementValues: JSON.stringify(metricValues(row)), payloadHash,
    }));
  }
  statements.push(database.prepare("UPDATE data_imports SET status='completed', row_count=? WHERE id=? AND organization_id=?")
    .bind(rows.length, id, context.organizationId));
  statements.push(audit("daily_metrics.imported", { importType: input.importType, rowCount: rows.length, replacementCount: reviewedRows.length, payloadHash }));
  try {
    await database.batch(statements);
  } catch (error) {
    const raced = replay(await findImport(), id, context.actorUserId);
    if (raced) return raced;
    if (error instanceof Error && /constraint/i.test(error.message)) {
      throw new ApiError(409, "IMPORT_REVIEW_STALE", "A daily record changed while the import was saving. No part of this import was saved. Review and try again.");
    }
    throw error;
  }
  return { kind: "saved" as const, import: { id, status: "completed", rowCount: rows.length }, replayed: false };
}
